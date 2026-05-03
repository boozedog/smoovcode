import { stdin, stdout } from "node:process";

const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const CSI_U_RE = new RegExp(String.raw`^\u001B\[(\d+);(\d+);(\d+)~`);
const SIMPLE_CSI_RE = new RegExp(String.raw`^\u001B\[[A-Za-z~]`);

/**
 * Read multi-line input from stdin using raw mode.
 * - Enter submits the input
 * - Shift+Enter (or Alt+Enter) inserts a newline
 * - Ctrl+C or Ctrl+D cancels with an error that has code "ERR_USE_AFTER_CLOSE"
 */
export async function readMultiLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [""];
    let lineIndex = 0;
    let cursor = 0;

    const renderPrompt = (isContinuation: boolean) => {
      if (isContinuation) {
        return `${CYAN}...${RESET} `;
      }
      return "\n> ";
    };

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onData);
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");

      // Process each byte/character
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const code = str.charCodeAt(i);

        // Check for escape sequences (CSI-u format for Shift+Enter or Alt+Enter)
        if (char === "\x1b") {
          // Look ahead for CSI-u sequence like [27;2;13~ (Shift+Enter) or [27;3;13~ (Alt+Enter)
          const remaining = str.slice(i);
          const match = remaining.match(CSI_U_RE);
          if (match) {
            const [, , mod, key] = match;
            // mod=2 is Shift, mod=3 is Alt; key=13 is Enter
            if ((mod === "2" || mod === "3") && key === "13") {
              // Shift+Enter or Alt+Enter - insert newline
              const currentLine = lines[lineIndex];
              const before = currentLine.slice(0, cursor);
              const after = currentLine.slice(cursor);
              lines[lineIndex] = before;
              lines.splice(lineIndex + 1, 0, after);
              lineIndex++;
              cursor = 0;
              stdout.write(`\n${renderPrompt(true)}`);
              i += match[0].length - 1;
              continue;
            }
            // Unknown CSI-u sequence, treat as ignored
            i += match[0].length - 1;
            continue;
          }
          // Standard escape sequences (arrow keys, etc) - ignore for now
          // Check for common sequences like \x1b[A (up), \x1b[B (down), etc.
          if (remaining.startsWith("\x1b[")) {
            // Skip the whole sequence (up to next letter usually)
            const seqMatch = remaining.match(SIMPLE_CSI_RE);
            if (seqMatch) {
              i += seqMatch[0].length - 1;
            } else {
              i++;
            }
            continue;
          }
          continue;
        }

        // Enter (\r or \n)
        if (char === "\r" || char === "\n") {
          lines[lineIndex] = lines[lineIndex].slice(0, cursor) + lines[lineIndex].slice(cursor);
          cleanup();
          // Join all lines with newlines
          resolve(lines.join("\n"));
          return;
        }

        // Ctrl+C (ETX, code 3)
        if (code === 3) {
          cleanup();
          const err = new Error("rl closed") as NodeJS.ErrnoException;
          err.code = "ERR_USE_AFTER_CLOSE";
          reject(err);
          return;
        }

        // Ctrl+D (EOT, code 4) - only if input is empty
        if (code === 4) {
          if (lines.every((l) => l === "")) {
            cleanup();
            const err = new Error("rl closed") as NodeJS.ErrnoException;
            err.code = "ERR_USE_AFTER_CLOSE";
            reject(err);
            return;
          }
          // Otherwise treat as delete forward (ignored for simplicity)
          continue;
        }

        // Backspace (code 8 or 127)
        if (code === 8 || code === 127) {
          if (cursor > 0) {
            const currentLine = lines[lineIndex];
            lines[lineIndex] = currentLine.slice(0, cursor - 1) + currentLine.slice(cursor);
            cursor--;
            redrawLine();
          } else if (lineIndex > 0) {
            // Merge with previous line
            const currentLine = lines[lineIndex];
            cursor = lines[lineIndex - 1].length;
            lines[lineIndex - 1] += currentLine;
            lines.splice(lineIndex, 1);
            lineIndex--;
            stdout.write("\x1b[A"); // Move up
            const prevLine = lines[lineIndex];
            const promptLen = lineIndex === 0 ? 2 : 4; // "> " or "... "
            stdout.write(`\r\x1b[K${lineIndex === 0 ? "> " : `${CYAN}...${RESET} `}${prevLine}`);
            stdout.write(`\r\x1b[${cursor + promptLen + 1}C`);
          }
          continue;
        }

        // Regular character - add to current line at cursor position
        if (code >= 32 && code < 127) {
          const currentLine = lines[lineIndex];
          lines[lineIndex] = currentLine.slice(0, cursor) + char + currentLine.slice(cursor);
          cursor++;
          stdout.write(char);
        }
      }
    };

    const redrawLine = () => {
      // Move cursor to start of current input line, clear to end, rewrite content
      const currentLine = lines[lineIndex] ?? "";
      const prompt = lineIndex === 0 ? "> " : `${CYAN}...${RESET} `;
      stdout.write(`\r\x1b[K${prompt}${currentLine}`);
      // Position cursor correctly
      const col = prompt.length + cursor;
      stdout.write(`\r\x1b[${col + 1}C`);
    };

    // Print initial prompt
    stdout.write(renderPrompt(false));

    stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
  });
}
