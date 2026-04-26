import type { Turn } from "@smoovcode/ui-core";
import { type AgentLike, useAgentSession } from "@smoovcode/ui-react";
import React from "react";
import { TurnView } from "./turn-view.tsx";

interface LiveTurnProps {
  agent: AgentLike;
  message: string;
  onDone: (turn: Turn) => void;
  onError?: (err: unknown) => void;
}

/**
 * Single live region. Re-renders during streaming; once `done`, calls `onDone`
 * with the finalized turn so the parent can move it into <Static> scrollback.
 */
export function LiveTurn({
  agent,
  message,
  onDone,
  onError,
}: LiveTurnProps): React.ReactElement | null {
  const session = useAgentSession({ agent, message });
  const live = session.conversation.live;
  const finalized = session.conversation.finalized.at(-1);

  const completedRef = React.useRef(false);
  if (session.done && finalized && !completedRef.current) {
    completedRef.current = true;
    queueMicrotask(() => onDone(finalized));
  }
  if (session.error && !completedRef.current) {
    completedRef.current = true;
    queueMicrotask(() => onError?.(session.error));
  }

  const turn = live ?? finalized;
  if (!turn) return null;

  return React.createElement(TurnView, { turn });
}
