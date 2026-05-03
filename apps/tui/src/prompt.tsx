import { Box, Text, useInput } from "ink";
import { createElement, useState, type ReactElement } from "react";

const SGR_MOUSE_INPUT_RE = /^(?:\[?<\d+;\d+;\d+[mM])+$/;
const MODIFIED_ENTER_INPUT_RE = /^\[(?:13;[23]u|27;[23];13~)$/;

interface PromptProps {
  onSubmit: (message: string) => void;
}

/**
 * Multi-line input prompt. Local state — typing never touches conversation
 * state, so other panels don't re-render on every keystroke.
 *
 * Submit / newline:
 * - Enter submits the buffered text.
 * - Shift+Enter (or Alt+Enter) inserts a newline. Requires the kitty
 *   keyboard protocol (enabled in `index.tsx`); on terminals without it
 *   the modifier bit is not delivered and Shift+Enter behaves like Enter.
 *
 * Editing: typing appends to the current (last) line; backspace removes
 * the last char of the current line, or — if the current line is empty —
 * collapses back into the previous line. There is no in-line cursor
 * navigation by design (keep the implementation tight).
 */
export function Prompt({ onSubmit }: PromptProps): ReactElement {
  const [lines, setLines] = useState<string[]>([""]);

  useInput((input, key) => {
    if (key.return) {
      // Shift+Enter / Alt+Enter inserts a newline rather than submitting.
      if (key.shift || key.meta) {
        setLines((ls) => [...ls, ""]);
        return;
      }
      const text = lines.join("\n").trim();
      if (text) {
        setLines([""]);
        onSubmit(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setLines((ls) => {
        const last = ls.length - 1;
        if (ls[last].length > 0) {
          const next = ls.slice();
          next[last] = next[last].slice(0, -1);
          return next;
        }
        if (ls.length > 1) return ls.slice(0, -1);
        return ls;
      });
      return;
    }
    if (MODIFIED_ENTER_INPUT_RE.test(input)) {
      setLines((ls) => [...ls, ""]);
      return;
    }
    if (SGR_MOUSE_INPUT_RE.test(input)) {
      return;
    }
    if (
      key.ctrl ||
      key.escape ||
      key.tab ||
      key.upArrow ||
      key.downArrow ||
      key.leftArrow ||
      key.rightArrow
    ) {
      return;
    }
    if (input)
      setLines((ls) => {
        const next = ls.slice();
        next[next.length - 1] = next[next.length - 1] + input;
        return next;
      });
  });

  return createElement(
    Box,
    { flexDirection: "column" },
    ...lines.map((line, idx) =>
      createElement(
        Box,
        { key: idx },
        createElement(Text, { color: idx === 0 ? "green" : "cyan" }, idx === 0 ? "> " : "... "),
        createElement(Text, null, idx === lines.length - 1 ? `${line}█` : line),
      ),
    ),
  );
}
