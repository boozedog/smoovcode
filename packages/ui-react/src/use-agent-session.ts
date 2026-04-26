import type { AgentEvent } from "@smoovcode/agent";
import {
  type ConversationEvent,
  type ConversationState,
  initialConversation,
  reduceConversation,
} from "@smoovcode/ui-core";
import { useState } from "react";
import { useMountEffect } from "./use-mount-effect.ts";

export interface AgentLike {
  run(message: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

export interface UseAgentSessionOptions {
  agent: AgentLike;
  message: string;
}

export interface AgentSessionState {
  conversation: ConversationState;
  done: boolean;
  error: unknown;
}

function startState(message: string): AgentSessionState {
  return {
    conversation: reduceConversation(initialConversation, {
      type: "turn-start",
      userMessage: message,
    }),
    done: false,
    error: null,
  };
}

/**
 * Subscribe-on-mount agent session. Drives a {@link ConversationState} via
 * `reduceConversation`, aborts the agent on unmount, and surfaces stream
 * errors. Use a per-turn `key` on the parent to drive fresh sessions.
 */
export function useAgentSession({ agent, message }: UseAgentSessionOptions): AgentSessionState {
  const [state, setState] = useState<AgentSessionState>(() => startState(message));

  useMountEffect(() => {
    const ctrl = new AbortController();

    void (async () => {
      try {
        for await (const ev of agent.run(message, ctrl.signal)) {
          if (ctrl.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            conversation: reduceConversation(prev.conversation, ev as ConversationEvent),
          }));
        }
        if (ctrl.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          conversation: reduceConversation(prev.conversation, { type: "turn-end" }),
          done: true,
        }));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState((prev) => ({ ...prev, error: err }));
      }
    })();

    return () => ctrl.abort();
  });

  return state;
}
