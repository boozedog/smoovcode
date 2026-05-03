export type ToolCallStatus = "running" | "done" | "error";

export interface TextBlock {
  kind: "text";
  id: string;
  text: string;
  status: "streaming" | "done";
}

export interface ReasoningBlock {
  kind: "reasoning";
  id: string;
  text: string;
  status: "streaming" | "done";
}

export interface ToolCallBlock {
  kind: "tool-call";
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  status: ToolCallStatus;
}

export interface ErrorBlock {
  kind: "error";
  id: string;
  error: string;
  status: "done";
}

export type Block = TextBlock | ReasoningBlock | ToolCallBlock | ErrorBlock;

/**
 * Back-compat alias so consumers that still import `ToolCallEntry` keep working.
 * New code should use `ToolCallBlock`.
 */
export type ToolCallEntry = ToolCallBlock;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Turn {
  id: number;
  userMessage: string;
  blocks: Block[];
  status: "streaming" | "done";
  usage?: TokenUsage;
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
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: string };

export const initialConversation: ConversationState = { finalized: [], live: null };

function nextTurnId(state: ConversationState): number {
  const last = state.finalized[state.finalized.length - 1];
  return last ? last.id + 1 : 0;
}

function newTurn(id: number, userMessage: string): Turn {
  return { id, userMessage, blocks: [], status: "streaming" };
}

function blockId(turn: Turn): string {
  return `b-${turn.id}-${turn.blocks.length}`;
}

/**
 * Close any streaming text/reasoning blocks. Tool-calls are intentionally left
 * alone — they can legitimately be in flight in parallel with new blocks
 * appearing (e.g. a model that starts speaking again before a tool returns).
 */
function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    if (b.kind === "text" && b.status === "streaming") return { ...b, status: "done" };
    if (b.kind === "reasoning" && b.status === "streaming") return { ...b, status: "done" };
    return b;
  });
}

/**
 * End-of-turn close: also force any still-running tool-call to done. Used only
 * by `finalizeTurn`, never on intra-turn boundaries.
 */
function closeAllStreaming(blocks: Block[]): Block[] {
  return closeStreamingText(blocks).map((b) =>
    b.kind === "tool-call" && b.status === "running" ? { ...b, status: "done" } : b,
  );
}

function finalizeTurn(turn: Turn): Turn {
  return { ...turn, blocks: closeAllStreaming(turn.blocks), status: "done" };
}

function appendDelta(live: Turn, kind: "text" | "reasoning", delta: string): { blocks: Block[] } {
  const last = live.blocks[live.blocks.length - 1];
  if (last && last.kind === kind && last.status === "streaming") {
    const updated: Block = { ...last, text: last.text + delta };
    const next = live.blocks.slice();
    next[next.length - 1] = updated;
    return { blocks: next };
  }
  // Start a new streaming block; first close any other streaming text/reasoning.
  const finalized = closeStreamingText(live.blocks);
  const fresh: Block =
    kind === "text"
      ? {
          kind: "text",
          id: blockId({ ...live, blocks: finalized }),
          text: delta,
          status: "streaming",
        }
      : {
          kind: "reasoning",
          id: blockId({ ...live, blocks: finalized }),
          text: delta,
          status: "streaming",
        };
  return { blocks: [...finalized, fresh] };
}

function lastRunningToolCallIndex(blocks: Block[], name: string): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b && b.kind === "tool-call" && b.name === name && b.status === "running") return i;
  }
  return -1;
}

export function reduceConversation(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  if (event.type === "turn-start") {
    if (state.live) {
      const finalized = [...state.finalized, finalizeTurn(state.live)];
      return { finalized, live: newTurn(nextTurnId({ finalized, live: null }), event.userMessage) };
    }
    return { ...state, live: newTurn(nextTurnId(state), event.userMessage) };
  }

  if (!state.live) return state;
  const live = state.live;

  switch (event.type) {
    case "turn-end":
      return { finalized: [...state.finalized, finalizeTurn(live)], live: null };
    case "text": {
      const { blocks } = appendDelta(live, "text", event.delta);
      return { ...state, live: { ...live, blocks } };
    }
    case "reasoning": {
      const { blocks } = appendDelta(live, "reasoning", event.delta);
      return { ...state, live: { ...live, blocks } };
    }
    case "tool-call": {
      const finalized = closeStreamingText(live.blocks);
      const fresh: ToolCallBlock = {
        kind: "tool-call",
        id: blockId({ ...live, blocks: finalized }),
        name: event.name,
        input: event.input,
        status: "running",
      };
      return { ...state, live: { ...live, blocks: [...finalized, fresh] } };
    }
    case "tool-result": {
      const idx = lastRunningToolCallIndex(live.blocks, event.name);
      if (idx === -1) return state;
      const target = live.blocks[idx] as ToolCallBlock;
      const next = live.blocks.slice();
      next[idx] = { ...target, status: "done", output: event.output };
      return { ...state, live: { ...live, blocks: next } };
    }
    case "tool-error": {
      const idx = lastRunningToolCallIndex(live.blocks, event.name);
      if (idx === -1) return state;
      const target = live.blocks[idx] as ToolCallBlock;
      const next = live.blocks.slice();
      next[idx] = { ...target, status: "error", error: event.error };
      return { ...state, live: { ...live, blocks: next } };
    }
    case "usage":
      return {
        ...state,
        live: {
          ...live,
          usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens },
        },
      };
    case "error": {
      const finalized = closeStreamingText(live.blocks);
      const fresh: ErrorBlock = {
        kind: "error",
        id: blockId({ ...live, blocks: finalized }),
        error: event.error,
        status: "done",
      };
      return { ...state, live: { ...live, blocks: [...finalized, fresh] } };
    }
  }
}
