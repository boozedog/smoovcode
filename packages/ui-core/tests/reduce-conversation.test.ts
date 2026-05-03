import { describe, expect, test } from "vite-plus/test";
import {
  type Block,
  type ConversationEvent,
  type ConversationState,
  initialConversation,
  reduceConversation,
  type ToolCallBlock,
} from "../src/index.ts";

function reduce(events: ConversationEvent[]): ConversationState {
  return events.reduce(reduceConversation, initialConversation);
}

function blocks(s: ConversationState): Block[] {
  return s.live?.blocks ?? [];
}

describe("reduceConversation", () => {
  test("initial state is empty: no finalized turns and no live turn", () => {
    expect(initialConversation).toEqual({ finalized: [], live: null });
  });

  test("turn-start opens a streaming live turn with no blocks yet", () => {
    const s = reduce([{ type: "turn-start", userMessage: "hi" }]);
    expect(s.live).not.toBeNull();
    expect(s.live?.userMessage).toBe("hi");
    expect(s.live?.status).toBe("streaming");
    expect(s.live?.blocks).toEqual([]);
    expect(s.finalized).toEqual([]);
  });

  test("text deltas append to the trailing streaming text block", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "Hello, " },
      { type: "text", delta: "world!" },
    ]);
    expect(blocks(s)).toHaveLength(1);
    const b = blocks(s)[0];
    expect(b.kind).toBe("text");
    if (b.kind === "text") {
      expect(b.text).toBe("Hello, world!");
      expect(b.status).toBe("streaming");
    }
  });

  test("reasoning deltas append to the trailing streaming reasoning block", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "reasoning", delta: "first " },
      { type: "reasoning", delta: "second" },
    ]);
    expect(blocks(s)).toHaveLength(1);
    const b = blocks(s)[0];
    expect(b.kind).toBe("reasoning");
    if (b.kind === "reasoning") {
      expect(b.text).toBe("first second");
      expect(b.status).toBe("streaming");
    }
  });

  test("tool-call finalizes the trailing text block and pushes a running tool-call block", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "thinking..." },
      { type: "tool-call", name: "echo", input: { text: "x" } },
    ]);
    const bs = blocks(s);
    expect(bs).toHaveLength(2);
    expect(bs[0].kind).toBe("text");
    expect(bs[0].status).toBe("done");
    expect(bs[1].kind).toBe("tool-call");
    if (bs[1].kind === "tool-call") {
      expect(bs[1].name).toBe("echo");
      expect(bs[1].input).toEqual({ text: "x" });
      expect(bs[1].status).toBe("running");
      expect(bs[1].id).toBeTruthy();
    }
  });

  test("a text-delta after a tool-call starts a fresh text block", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "before" },
      { type: "tool-call", name: "t", input: {} },
      { type: "tool-result", name: "t", output: "done" },
      { type: "text", delta: "after" },
    ]);
    const bs = blocks(s);
    expect(bs.map((b) => b.kind)).toEqual(["text", "tool-call", "text"]);
    expect((bs[0] as Extract<Block, { kind: "text" }>).text).toBe("before");
    expect((bs[2] as Extract<Block, { kind: "text" }>).text).toBe("after");
  });

  test("tool-result completes the most recent running tool-call block (LIFO) by name", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-call", name: "echo", input: { i: 1 } },
      { type: "tool-call", name: "echo", input: { i: 2 } },
      { type: "tool-result", name: "echo", output: "second" },
      { type: "tool-result", name: "echo", output: "first" },
    ]);
    const tcs = blocks(s).filter((b): b is ToolCallBlock => b.kind === "tool-call");
    expect(tcs).toHaveLength(2);
    expect(tcs[1].output).toBe("second");
    expect(tcs[0].output).toBe("first");
    expect(tcs.every((t) => t.status === "done")).toBe(true);
  });

  test("tool-error marks the most recent running tool-call block as errored", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-call", name: "echo", input: {} },
      { type: "tool-error", name: "echo", error: "boom" },
    ]);
    const tc = blocks(s)[0] as ToolCallBlock;
    expect(tc.status).toBe("error");
    expect(tc.error).toBe("boom");
  });

  test("tool-result with no matching running call is dropped (no crash, no new block)", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-result", name: "ghost", output: "nope" },
    ]);
    expect(blocks(s)).toEqual([]);
  });

  test("error event finalizes the trailing streaming block and appends an error block", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "answer" },
      { type: "error", error: "oops" },
    ]);
    const bs = blocks(s);
    expect(bs).toHaveLength(2);
    expect(bs[0].kind).toBe("text");
    expect(bs[0].status).toBe("done");
    expect(bs[1].kind).toBe("error");
    if (bs[1].kind === "error") {
      expect(bs[1].error).toBe("oops");
    }
  });

  test("usage events update live turn token counts", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "usage", inputTokens: 1234, outputTokens: 56 },
    ]);

    expect(s.live?.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  });

  test("turn-end finalizes all streaming/running blocks and the turn", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "answer" },
      { type: "tool-call", name: "t", input: {} },
      { type: "turn-end" },
    ]);
    expect(s.live).toBeNull();
    expect(s.finalized).toHaveLength(1);
    const turn = s.finalized[0];
    expect(turn.status).toBe("done");
    expect(turn.blocks).toHaveLength(2);
    expect(turn.blocks[0].status).toBe("done");
    // A still-running tool-call at turn-end is force-completed (status=done with no output).
    expect(turn.blocks[1].status).toBe("done");
  });

  test("each new turn gets a unique sequential id", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "a" },
      { type: "turn-end" },
      { type: "turn-start", userMessage: "b" },
      { type: "turn-end" },
    ]);
    expect(s.finalized.map((t) => t.id)).toEqual([0, 1]);
  });

  test("starting a new turn while one is live finalizes the previous turn first", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "a" },
      { type: "text", delta: "first" },
      { type: "turn-start", userMessage: "b" },
    ]);
    expect(s.finalized).toHaveLength(1);
    expect(s.finalized[0].status).toBe("done");
    expect(s.finalized[0].blocks[0].status).toBe("done");
    expect(s.live?.userMessage).toBe("b");
  });

  test("events received with no live turn are ignored (defensive: no crash)", () => {
    const s = reduce([
      { type: "text", delta: "stray" },
      { type: "tool-call", name: "x", input: {} },
      { type: "error", error: "stray" },
      { type: "turn-end" },
    ]);
    expect(s).toEqual(initialConversation);
  });

  test("reducer is pure: state input is not mutated", () => {
    const s1: ConversationState = initialConversation;
    const s2 = reduceConversation(s1, { type: "turn-start", userMessage: "hi" });
    expect(s1).toEqual({ finalized: [], live: null });
    expect(s2).not.toBe(s1);
  });

  test("block ids are unique within a turn", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "a" },
      { type: "tool-call", name: "t", input: {} },
      { type: "tool-result", name: "t", output: 1 },
      { type: "text", delta: "b" },
      { type: "error", error: "e" },
    ]);
    const ids = blocks(s).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
