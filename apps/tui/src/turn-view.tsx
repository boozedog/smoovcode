import type { ToolCallEntry, Turn } from "@smoovcode/ui-core";
import { Box, Text } from "ink";
import React from "react";
import { HighlightedCode } from "./highlighted-code.tsx";

interface TurnViewProps {
  turn: Turn;
}

/**
 * Pure render of a Turn. Used both by `<LiveTurn>` (during streaming) and by
 * the `<Static>` finalized list — sharing one component is the mechanism that
 * makes the handoff byte-identical.
 */
export function TurnView({ turn }: TurnViewProps): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { color: "cyan" }, `> ${turn.userMessage}`),
    turn.reasoning
      ? React.createElement(
          Text,
          { dimColor: true, key: "reasoning" },
          `thinking: ${turn.reasoning}`,
        )
      : null,
    turn.toolCalls.map((tc) => React.createElement(ToolCallView, { key: tc.id, call: tc })),
    turn.text
      ? React.createElement(HighlightedCode, { key: "text", code: turn.text, lang: "md" })
      : null,
    turn.errors.map((e, i) =>
      React.createElement(Text, { key: `err-${i}`, color: "red" }, `[error] ${e}`),
    ),
  );
}

function isCodemodeInput(x: unknown): x is { code: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "code" in x &&
    typeof (x as { code: unknown }).code === "string"
  );
}

function ToolCallView({ call }: { call: ToolCallEntry }): React.ReactElement {
  // Codemode: render the TS source the model wrote, plus a JSON-pretty result.
  if (call.name === "codemode" && isCodemodeInput(call.input)) {
    const result = extractResult(call.output);
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { color: "magenta" }, `[${call.name}]`),
      React.createElement(HighlightedCode, { code: call.input.code, lang: "ts" }),
      call.status === "done"
        ? React.createElement(HighlightedCode, {
            code: `→ ${JSON.stringify(result, null, 2)}`,
            lang: "json",
          })
        : null,
      call.status === "error"
        ? React.createElement(Text, { color: "red" }, `✗ ${call.error}`)
        : null,
    );
  }

  // Default: single-line rendering matches the prior CLI output for parity
  // with the existing TurnView tests.
  const head = `[${call.name}] ${JSON.stringify(call.input)}`;
  let tail = "";
  if (call.status === "done") {
    tail = ` → ${JSON.stringify(extractResult(call.output))}`;
  } else if (call.status === "error") {
    tail = ` ✗ ${call.error}`;
  }
  return React.createElement(Text, null, head + tail);
}

function extractResult(o: unknown): unknown {
  return o && typeof o === "object" && "result" in o ? (o as { result: unknown }).result : o;
}
