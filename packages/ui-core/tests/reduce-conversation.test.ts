import { describe, expect, test } from "vite-plus/test";
import {
  type ConversationEvent,
  type ConversationState,
  initialConversation,
  reduceConversation,
} from "../src/index.ts";

function reduce(events: ConversationEvent[]): ConversationState {
  return events.reduce(reduceConversation, initialConversation);
}

describe("reduceConversation", () => {
  test("initial state is empty: no finalized turns and no live turn", () => {
    expect(initialConversation).toEqual({ finalized: [], live: null });
  });

  test("turn-start opens a streaming live turn carrying the user message", () => {
    const s = reduce([{ type: "turn-start", userMessage: "hi" }]);
    expect(s.live).not.toBeNull();
    expect(s.live?.userMessage).toBe("hi");
    expect(s.live?.status).toBe("streaming");
    expect(s.live?.text).toBe("");
    expect(s.live?.reasoning).toBe("");
    expect(s.live?.toolCalls).toEqual([]);
    expect(s.live?.errors).toEqual([]);
    expect(s.finalized).toEqual([]);
  });

  test("text deltas accumulate on the live turn", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "Hello, " },
      { type: "text", delta: "world!" },
    ]);
    expect(s.live?.text).toBe("Hello, world!");
  });

  test("reasoning deltas accumulate on the live turn", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "reasoning", delta: "first " },
      { type: "reasoning", delta: "second" },
    ]);
    expect(s.live?.reasoning).toBe("first second");
  });

  test("tool-call adds a running entry with a stable id", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-call", name: "echo", input: { text: "x" } },
    ]);
    expect(s.live?.toolCalls).toHaveLength(1);
    const tc = s.live!.toolCalls[0];
    expect(tc.name).toBe("echo");
    expect(tc.input).toEqual({ text: "x" });
    expect(tc.status).toBe("running");
    expect(tc.id).toBeTruthy();
  });

  test("tool-result completes the most recent running call with the same name", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-call", name: "echo", input: { text: "x" } },
      { type: "tool-result", name: "echo", output: { result: "ok" } },
    ]);
    const tc = s.live!.toolCalls[0];
    expect(tc.status).toBe("done");
    expect(tc.output).toEqual({ result: "ok" });
  });

  test("tool-error completes the most recent running call with status=error", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-call", name: "echo", input: {} },
      { type: "tool-error", name: "echo", error: "boom" },
    ]);
    const tc = s.live!.toolCalls[0];
    expect(tc.status).toBe("error");
    expect(tc.error).toBe("boom");
  });

  test("interleaved calls of the same tool pair LIFO with their results", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-call", name: "echo", input: { i: 1 } },
      { type: "tool-call", name: "echo", input: { i: 2 } },
      { type: "tool-result", name: "echo", output: "second" },
      { type: "tool-result", name: "echo", output: "first" },
    ]);
    const calls = s.live!.toolCalls;
    expect(calls).toHaveLength(2);
    // Pairing strategy: most recent running call wins (LIFO).
    expect(calls[1].output).toBe("second");
    expect(calls[0].output).toBe("first");
  });

  test("tool-result with no matching running call is dropped (no crash, no new entry)", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "tool-result", name: "ghost", output: "nope" },
    ]);
    expect(s.live?.toolCalls).toEqual([]);
  });

  test("error event accumulates onto the live turn's errors", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "error", error: "oops" },
      { type: "error", error: "again" },
    ]);
    expect(s.live?.errors).toEqual(["oops", "again"]);
  });

  test("turn-end finalizes the live turn (moves to finalized, clears live, marks done)", () => {
    const s = reduce([
      { type: "turn-start", userMessage: "hi" },
      { type: "text", delta: "answer" },
      { type: "turn-end" },
    ]);
    expect(s.live).toBeNull();
    expect(s.finalized).toHaveLength(1);
    expect(s.finalized[0].text).toBe("answer");
    expect(s.finalized[0].status).toBe("done");
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
    expect(s.finalized[0].text).toBe("first");
    expect(s.finalized[0].status).toBe("done");
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
});
