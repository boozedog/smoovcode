import { Box, Text, useInput } from "ink";
import React from "react";

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
export function Prompt({ onSubmit }: PromptProps): React.ReactElement {
  const [lines, setLines] = React.useState<string[]>([""]);

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

  return React.createElement(
    Box,
    { flexDirection: "column" },
    ...lines.map((line, idx) =>
      React.createElement(
        Box,
        { key: idx },
        React.createElement(
          Text,
          { color: idx === 0 ? "green" : "cyan" },
          idx === 0 ? "> " : "... ",
        ),
        React.createElement(Text, null, line),
      ),
    ),
  );
}
