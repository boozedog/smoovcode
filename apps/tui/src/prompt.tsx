import { Box, Text, useInput } from "ink";
import React from "react";

interface PromptProps {
  onSubmit: (message: string) => void;
}

/**
 * Local-state input. Typing never touches conversation state, so other panels
 * don't re-render on every keystroke.
 */
export function Prompt({ onSubmit }: PromptProps): React.ReactElement {
  const [value, setValue] = React.useState("");

  useInput((input, key) => {
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        setValue("");
        onSubmit(trimmed);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (
      key.ctrl ||
      key.meta ||
      key.escape ||
      key.tab ||
      key.upArrow ||
      key.downArrow ||
      key.leftArrow ||
      key.rightArrow
    ) {
      return;
    }
    if (input) setValue((v) => v + input);
  });

  return React.createElement(
    Box,
    null,
    React.createElement(Text, { color: "green" }, "> "),
    React.createElement(Text, null, value),
  );
}
