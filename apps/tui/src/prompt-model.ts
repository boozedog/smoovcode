export interface KeyInput {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const MODIFIED_ENTER_INPUT_RE = /^\[(?:13;[23]u|27;[23];13~)$/;

export function parseKey(sequence: string): KeyInput {
  if (sequence === "\r" || sequence === "\n") return { sequence, name: "enter" };
  if (sequence === "\u007f" || sequence === "\b") return { sequence, name: "backspace" };
  if (sequence === "\u0003") return { sequence, name: "c", ctrl: true };
  if (MODIFIED_ENTER_INPUT_RE.test(sequence)) return { sequence, name: "enter", shift: true };
  return { sequence };
}

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

  renderLines(): string[] {
    return this.lines.map((line, idx) => `${idx === 0 ? "> " : "... "}${line}`);
  }
}
