export interface Terminal {
  rows: number;
  cols: number;
  isTTY: boolean;
  write(chunk: string): void;
}

export class FakeTerminal implements Terminal {
  rows: number;
  cols: number;
  isTTY = true;
  output = "";

  constructor({ rows, cols }: { rows: number; cols: number }) {
    this.rows = rows;
    this.cols = cols;
  }

  write(chunk: string): void {
    this.output += chunk;
  }

  clearOutput(): void {
    this.output = "";
  }
}

interface CursorPosition {
  line: number;
  column: number;
}

interface WrappedCursor {
  row: number;
  column: number;
}

const CSI = "\u001b[";
const SYNC_START = `${CSI}?2026h`;
const SYNC_END = `${CSI}?2026l`;

export class TerminalRenderer {
  private previousLines: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private cursorRow = 0;
  private hardwareCursorRow = 0;
  private previousViewportTop = 0;

  constructor(private readonly terminal: Terminal) {}

  render(lines: string[], opts: { force?: boolean; cursor?: CursorPosition } = {}): void {
    const width = this.terminal.cols;
    const height = this.terminal.rows;
    const wrapped = wrapLines(lines, width, opts.cursor);
    const newLines = wrapped.lines;
    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
    const previousBufferLength =
      this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
    let prevViewportTop = heightChanged
      ? Math.max(0, previousBufferLength - height)
      : this.previousViewportTop;
    let viewportTop = prevViewportTop;
    let hardwareCursorRow = this.hardwareCursorRow;

    const computeLineDiff = (targetRow: number): number => {
      const currentScreenRow = hardwareCursorRow - prevViewportTop;
      const targetScreenRow = targetRow - viewportTop;
      return targetScreenRow - currentScreenRow;
    };

    const fullRender = (clear: boolean): void => {
      let buffer = SYNC_START;
      if (clear) buffer += `${CSI}2J${CSI}H${CSI}3J`;
      buffer += newLines.join("\r\n");
      buffer += SYNC_END;
      this.terminal.write(buffer);
      this.cursorRow = Math.max(0, newLines.length - 1);
      this.hardwareCursorRow = this.cursorRow;
      const bufferLength = Math.max(height, newLines.length);
      this.previousViewportTop = Math.max(0, bufferLength - height);
      this.positionHardwareCursor(wrapped.cursor, newLines.length);
      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
    };

    if (opts.force) {
      this.previousLines = [];
      this.previousWidth = -1;
      this.previousHeight = -1;
      this.cursorRow = 0;
      this.hardwareCursorRow = 0;
      this.previousViewportTop = 0;
    }

    if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
      fullRender(false);
      return;
    }

    if (widthChanged || heightChanged) {
      fullRender(true);
      return;
    }

    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, this.previousLines.length);
    for (let i = 0; i < maxLines; i += 1) {
      const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
      const newLine = i < newLines.length ? newLines[i] : "";
      if (oldLine !== newLine) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }

    const appendedLines = newLines.length > this.previousLines.length;
    if (appendedLines) {
      if (firstChanged === -1) firstChanged = this.previousLines.length;
      lastChanged = newLines.length - 1;
    }
    const appendStart =
      appendedLines && firstChanged === this.previousLines.length && firstChanged > 0;

    if (firstChanged === -1) {
      this.positionHardwareCursor(wrapped.cursor, newLines.length);
      this.previousViewportTop = prevViewportTop;
      this.previousHeight = height;
      return;
    }

    if (firstChanged < prevViewportTop) {
      fullRender(true);
      return;
    }

    let buffer = SYNC_START;
    const prevViewportBottom = prevViewportTop + height - 1;
    const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;
    if (moveTargetRow > prevViewportBottom) {
      const currentScreenRow = Math.max(
        0,
        Math.min(height - 1, hardwareCursorRow - prevViewportTop),
      );
      const moveToBottom = height - 1 - currentScreenRow;
      if (moveToBottom > 0) buffer += `${CSI}${moveToBottom}B`;
      const scroll = moveTargetRow - prevViewportBottom;
      buffer += "\r\n".repeat(scroll);
      prevViewportTop += scroll;
      viewportTop += scroll;
      hardwareCursorRow = moveTargetRow;
    }

    const lineDiff = computeLineDiff(moveTargetRow);
    if (lineDiff > 0) buffer += `${CSI}${lineDiff}B`;
    else if (lineDiff < 0) buffer += `${CSI}${-lineDiff}A`;
    buffer += appendStart ? "\r\n" : "\r";

    const renderEnd = Math.min(lastChanged, newLines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i += 1) {
      if (i > firstChanged) buffer += "\r\n";
      buffer += `${CSI}2K${newLines[i]}`;
    }

    let finalCursorRow = renderEnd;
    if (this.previousLines.length > newLines.length) {
      if (renderEnd < newLines.length - 1) {
        const moveDown = newLines.length - 1 - renderEnd;
        buffer += `${CSI}${moveDown}B`;
        finalCursorRow = newLines.length - 1;
      }
      const extraLines = this.previousLines.length - newLines.length;
      for (let i = newLines.length; i < this.previousLines.length; i += 1) {
        buffer += `\r\n${CSI}2K`;
      }
      if (extraLines > 0) buffer += `${CSI}${extraLines}A`;
    }

    buffer += SYNC_END;
    this.terminal.write(buffer);

    this.cursorRow = Math.max(0, newLines.length - 1);
    this.hardwareCursorRow = finalCursorRow;
    this.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);
    this.positionHardwareCursor(wrapped.cursor, newLines.length);
    this.previousLines = newLines;
    this.previousWidth = width;
    this.previousHeight = height;
  }

  clear(): void {
    this.previousLines = [];
    this.previousWidth = 0;
    this.previousHeight = 0;
    this.cursorRow = 0;
    this.hardwareCursorRow = 0;
    this.previousViewportTop = 0;
  }

  private positionHardwareCursor(cursor: WrappedCursor | undefined, totalLines: number): void {
    if (!cursor || totalLines <= 0) return;
    const targetRow = Math.max(0, Math.min(cursor.row, totalLines - 1));
    const targetCol = Math.max(0, cursor.column);
    const rowDelta = targetRow - this.hardwareCursorRow;
    let buffer = "";
    if (rowDelta > 0) buffer += `${CSI}${rowDelta}B`;
    else if (rowDelta < 0) buffer += `${CSI}${-rowDelta}A`;
    buffer += `${CSI}${targetCol + 1}G`;
    this.terminal.write(buffer);
    this.hardwareCursorRow = targetRow;
  }
}

function wrapLines(
  lines: readonly string[],
  cols: number,
  cursor?: CursorPosition,
): { lines: string[]; cursor?: WrappedCursor } {
  // Keep one column spare. Writing a full-width row followed by CRLF triggers
  // terminal autowrap first and leaves the cursor one physical row lower than
  // our model, which corrupts later bottom-region rewrites while streaming.
  const width = Math.max(1, cols - 1);
  const wrapped: string[] = [];
  let wrappedCursor: WrappedCursor | undefined;

  lines.forEach((line, lineIdx) => {
    const start = wrapped.length;
    if (line.length === 0) {
      wrapped.push("");
    } else {
      for (let idx = 0; idx < line.length; idx += width) {
        wrapped.push(line.slice(idx, idx + width));
      }
    }

    if (cursor && cursor.line === lineIdx) {
      wrappedCursor = {
        row: start + Math.floor(cursor.column / width),
        column: cursor.column % width,
      };
    }
  });

  return { lines: wrapped, ...(wrappedCursor ? { cursor: wrappedCursor } : {}) };
}
