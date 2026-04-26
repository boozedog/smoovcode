export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCallEntry {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  status: ToolCallStatus;
}

export interface Turn {
  id: number;
  userMessage: string;
  text: string;
  reasoning: string;
  toolCalls: ToolCallEntry[];
  errors: string[];
  status: "streaming" | "done";
}

export interface ConversationState {
  finalized: Turn[];
  live: Turn | null;
}

export type ConversationEvent =
  | { type: "turn-start"; userMessage: string }
  | { type: "turn-end" }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown }
  | { type: "tool-error"; name: string; error: string }
  | { type: "error"; error: string };

export const initialConversation: ConversationState = { finalized: [], live: null };

function nextTurnId(state: ConversationState): number {
  const last = state.finalized[state.finalized.length - 1];
  return last ? last.id + 1 : 0;
}

function newTurn(id: number, userMessage: string): Turn {
  return {
    id,
    userMessage,
    text: "",
    reasoning: "",
    toolCalls: [],
    errors: [],
    status: "streaming",
  };
}

function finalize(turn: Turn): Turn {
  return { ...turn, status: "done" };
}

export function reduceConversation(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  if (event.type === "turn-start") {
    if (state.live) {
      const finalized = [...state.finalized, finalize(state.live)];
      return { finalized, live: newTurn(nextTurnId({ finalized, live: null }), event.userMessage) };
    }
    return { ...state, live: newTurn(nextTurnId(state), event.userMessage) };
  }

  if (!state.live) return state;
  const live = state.live;

  switch (event.type) {
    case "turn-end":
      return { finalized: [...state.finalized, finalize(live)], live: null };
    case "text":
      return { ...state, live: { ...live, text: live.text + event.delta } };
    case "reasoning":
      return { ...state, live: { ...live, reasoning: live.reasoning + event.delta } };
    case "tool-call": {
      const id = `tc-${live.id}-${live.toolCalls.length}`;
      const entry: ToolCallEntry = {
        id,
        name: event.name,
        input: event.input,
        status: "running",
      };
      return { ...state, live: { ...live, toolCalls: [...live.toolCalls, entry] } };
    }
    case "tool-result": {
      const idx = lastRunningIndex(live.toolCalls, event.name);
      if (idx === -1) return state;
      const next = live.toolCalls.slice();
      next[idx] = { ...next[idx], status: "done", output: event.output };
      return { ...state, live: { ...live, toolCalls: next } };
    }
    case "tool-error": {
      const idx = lastRunningIndex(live.toolCalls, event.name);
      if (idx === -1) return state;
      const next = live.toolCalls.slice();
      next[idx] = { ...next[idx], status: "error", error: event.error };
      return { ...state, live: { ...live, toolCalls: next } };
    }
    case "error":
      return { ...state, live: { ...live, errors: [...live.errors, event.error] } };
  }
}

function lastRunningIndex(calls: ToolCallEntry[], name: string): number {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c && c.name === name && c.status === "running") return i;
  }
  return -1;
}
