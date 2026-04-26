import type { Block, ToolCallBlock } from "@smoovcode/ui-core";
import { Box, Text } from "ink";
import React from "react";
import { HighlightedCode } from "./highlighted-code.tsx";
import { Spinner } from "./spinner.tsx";

interface BlockViewProps {
  block: Block;
}

export function BlockView({ block }: BlockViewProps): React.ReactElement {
  switch (block.kind) {
    case "text":
      return React.createElement(HighlightedCode, { code: block.text, lang: "md" });
    case "reasoning":
      return React.createElement(Text, { dimColor: true }, `thinking: ${block.text}`);
    case "tool-call":
      return React.createElement(ToolCallView, { block });
    case "error":
      return React.createElement(Text, { color: "red" }, `[error] ${block.error}`);
  }
}

function isCodemodeInput(x: unknown): x is { code: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "code" in x &&
    typeof (x as { code: unknown }).code === "string"
  );
}

function ToolCallView({ block }: { block: ToolCallBlock }): React.ReactElement {
  // Codemode: render the TS source the model wrote, plus a JSON-pretty result.
  if (block.name === "codemode" && isCodemodeInput(block.input)) {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(
        Box,
        null,
        React.createElement(Text, { color: "magenta" }, `[${block.name}]`),
        block.status === "running"
          ? React.createElement(Box, { marginLeft: 1 }, React.createElement(Spinner, null))
          : null,
      ),
      React.createElement(HighlightedCode, { code: block.input.code, lang: "ts" }),
      block.status === "done"
        ? React.createElement(HighlightedCode, {
            code: `→ ${JSON.stringify(extractResult(block.output), null, 2)}`,
            lang: "json",
          })
        : null,
      block.status === "error"
        ? React.createElement(Text, { color: "red" }, `✗ ${block.error}`)
        : null,
    );
  }

  // Default: single-line rendering, with a leading spinner while running.
  const head = `[${block.name}] ${JSON.stringify(block.input)}`;
  let tail = "";
  if (block.status === "done") {
    tail = ` → ${JSON.stringify(extractResult(block.output))}`;
  } else if (block.status === "error") {
    tail = ` ✗ ${block.error}`;
  }
  if (block.status === "running") {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, head),
      React.createElement(Box, { marginLeft: 1 }, React.createElement(Spinner, null)),
    );
  }
  return React.createElement(Text, null, head + tail);
}

function extractResult(o: unknown): unknown {
  return o && typeof o === "object" && "result" in o ? (o as { result: unknown }).result : o;
}
