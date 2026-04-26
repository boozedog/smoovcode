import type { Turn } from "@smoovcode/ui-core";
import { Box, Text } from "ink";
import React from "react";
import { BlockView } from "./block-view.tsx";

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
    turn.blocks.map((b) => React.createElement(BlockView, { key: b.id, block: b })),
  );
}
