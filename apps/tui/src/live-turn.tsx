import type { Block } from "@smoovcode/ui-core";
import { type AgentLike, useAgentSession } from "@smoovcode/ui-react";
import { Box } from "ink";
import React from "react";
import { BlockView } from "./block-view.tsx";

interface LiveTurnProps {
  agent: AgentLike;
  message: string;
  /**
   * Called once per block as it transitions out of streaming/running into a
   * terminal state. App promotes the block into `<Static>` scrollback.
   */
  onBlockFinalize: (block: Block, turnId: number) => void;
  /** Called once when the turn-end event has finalized all blocks. */
  onTurnDone: (turnId: number) => void;
  onError?: (err: unknown) => void;
}

function isBlockFinal(b: Block): boolean {
  return (
    (b.kind === "text" && b.status === "done") ||
    (b.kind === "reasoning" && b.status === "done") ||
    (b.kind === "tool-call" && b.status !== "running") ||
    b.kind === "error"
  );
}

/**
 * Live region for one in-progress turn. Emits each block to App as soon as
 * it reaches a terminal state, so the App can promote it into <Static>
 * scrollback. The component itself only renders the still-streaming tail.
 */
export function LiveTurn({
  agent,
  message,
  onBlockFinalize,
  onTurnDone,
  onError,
}: LiveTurnProps): React.ReactElement | null {
  const session = useAgentSession({ agent, message });
  const live = session.conversation.live;
  const finalized = session.conversation.finalized.at(-1);
  const turn = live ?? finalized;

  const emittedRef = React.useRef<Set<string>>(new Set());
  const turnDoneRef = React.useRef(false);

  if (turn) {
    for (const b of turn.blocks) {
      if (isBlockFinal(b) && !emittedRef.current.has(b.id)) {
        emittedRef.current.add(b.id);
        const block = b;
        const turnId = turn.id;
        queueMicrotask(() => onBlockFinalize(block, turnId));
      }
    }
  }

  if (session.done && finalized && !turnDoneRef.current) {
    turnDoneRef.current = true;
    const turnId = finalized.id;
    queueMicrotask(() => onTurnDone(turnId));
  }
  if (session.error && !turnDoneRef.current) {
    turnDoneRef.current = true;
    queueMicrotask(() => onError?.(session.error));
  }

  if (!turn) return null;

  const tail = turn.blocks.filter((b) => !isBlockFinal(b));
  if (tail.length === 0) return null;

  return React.createElement(
    Box,
    { flexDirection: "column" },
    tail.map((b) => React.createElement(BlockView, { key: b.id, block: b })),
  );
}
