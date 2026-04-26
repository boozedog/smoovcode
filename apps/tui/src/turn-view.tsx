import type { Turn } from "@smoovcode/ui-core";
import { Box, Text } from "ink";
import React from "react";

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
    turn.toolCalls.map((tc) => {
      const head = `[${tc.name}] ${JSON.stringify(tc.input)}`;
      let tail = "";
      if (tc.status === "done") {
        const o = tc.output;
        const compact =
          o && typeof o === "object" && "result" in o ? (o as { result: unknown }).result : o;
        tail = ` → ${JSON.stringify(compact)}`;
      } else if (tc.status === "error") {
        tail = ` ✗ ${tc.error}`;
      }
      return React.createElement(Text, { key: tc.id }, head + tail);
    }),
    turn.text ? React.createElement(Text, { key: "text" }, turn.text) : null,
    turn.errors.map((e, i) =>
      React.createElement(Text, { key: `err-${i}`, color: "red" }, `[error] ${e}`),
    ),
  );
}
