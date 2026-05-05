export interface KeyInput {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const ESC = "\u001b";
const MODIFIED_ENTER_INPUT_RE = /^\[(?:13;[23]u|27;[23];13~)$/;
const CSI_U_RE = /^\[(\d+);(\d+)u$/;
const XTERM_MODIFIED_KEY_RE = /^\[27;(\d+);(\d+)~$/;

export function isModifiedEnterSequence(sequence: string): boolean {
  const normalized = sequence.startsWith(ESC) ? sequence.slice(1) : sequence;
  return MODIFIED_ENTER_INPUT_RE.test(normalized);
}

export function isEncodedKeySequence(sequence: string): boolean {
  const normalized = sequence.startsWith(ESC) ? sequence.slice(1) : sequence;
  return CSI_U_RE.test(normalized) || XTERM_MODIFIED_KEY_RE.test(normalized);
}

export function parseKey(sequence: string): KeyInput {
  if (sequence === "\r" || sequence === "\n") return { sequence, name: "enter" };
  if (sequence === "\u007f" || sequence === "\b") return { sequence, name: "backspace" };
  if (sequence === "\u0003") return { sequence, name: "c", ctrl: true };
  const encodedKey = parseEncodedKey(sequence);
  if (encodedKey) return encodedKey;
  if (isModifiedEnterSequence(sequence)) return { sequence, name: "enter", shift: true };
  return { sequence };
}

function parseEncodedKey(sequence: string): KeyInput | null {
  const normalized = sequence.startsWith(ESC) ? sequence.slice(1) : sequence;
  const csiUMatch = CSI_U_RE.exec(normalized);
  const xtermMatch = XTERM_MODIFIED_KEY_RE.exec(normalized);
  const modifierText = csiUMatch?.[2] ?? xtermMatch?.[1];
  const codepointText = csiUMatch?.[1] ?? xtermMatch?.[2];
  if (!modifierText || !codepointText) return null;

  const codepoint = Number(codepointText);
  const modifier = Number(modifierText);
  if (!Number.isInteger(codepoint) || !Number.isInteger(modifier)) return null;

  const char = String.fromCodePoint(codepoint);
  const name = codepoint === 13 ? "enter" : char.toLowerCase();
  return {
    sequence,
    name,
    ...(modifierHasShift(modifier) ? { shift: true } : {}),
    ...(modifierHasAlt(modifier) ? { meta: true } : {}),
    ...(modifierHasCtrl(modifier) ? { ctrl: true } : {}),
  };
}

function modifierHasShift(modifier: number): boolean {
  return ((modifier - 1) & 1) !== 0;
}

function modifierHasAlt(modifier: number): boolean {
  return ((modifier - 1) & 2) !== 0;
}

function modifierHasCtrl(modifier: number): boolean {
  return ((modifier - 1) & 4) !== 0;
}

export interface PromptRenderOptions {
  focused?: boolean;
  cursorVisible?: boolean;
}

const ACTIVE_CURSOR = "\u001b[92m█\u001b[39m";
const INACTIVE_CURSOR = "\u001b[92m░\u001b[39m";

export class PromptModel {
  lines: string[] = [""];

  handleKey(key: KeyInput, onSubmit: (message: string) => void): void {
    if (key.name === "enter") {
      if (key.shift || key.meta) {
        this.lines = [...this.lines, ""];
        return;
      }
      const text = this.lines.join("\n").trim();
      if (text) {
        this.lines = [""];
        onSubmit(text);
      }
      return;
    }

    if (key.name === "backspace" || key.name === "delete") {
      const last = this.lines.length - 1;
      if (this.lines[last].length > 0) {
        const next = this.lines.slice();
        next[last] = next[last].slice(0, -1);
        this.lines = next;
      } else if (this.lines.length > 1) {
        this.lines = this.lines.slice(0, -1);
      }
      return;
    }

    if (
      key.ctrl ||
      key.name === "escape" ||
      key.name === "tab" ||
      key.name === "up" ||
      key.name === "down" ||
      key.name === "left" ||
      key.name === "right"
    ) {
      return;
    }

    const text = key.sequence ?? "";
    if (!text) return;
    const next = this.lines.slice();
    next[next.length - 1] += text;
    this.lines = next;
  }

  renderLines(opts: PromptRenderOptions = {}): string[] {
    const renderCursor = opts.focused !== undefined || opts.cursorVisible !== undefined;
    const focused = opts.focused ?? true;
    const cursor = renderCursor
      ? focused
        ? opts.cursorVisible === false
          ? ""
          : ACTIVE_CURSOR
        : INACTIVE_CURSOR
      : "";
    return this.lines.map((line, idx) => {
      const rendered = `${idx === 0 ? "> " : "... "}${line}`;
      return idx === this.lines.length - 1 ? `${rendered}${cursor}` : rendered;
    });
  }
}
