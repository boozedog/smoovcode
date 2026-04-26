import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { coalesceTextDeltas, type ConversationEvent } from "../src/index.ts";

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of stream) out.push(item);
  return out;
}

describe("coalesceTextDeltas", () => {
  test("merges consecutive text deltas into a single event when within tickMs", async () => {
    const events: ConversationEvent[] = [
      { type: "text", delta: "Hello, " },
      { type: "text", delta: "world!" },
    ];
    const out = await collect(coalesceTextDeltas(asyncIter(events), 1000));
    expect(out).toEqual([{ type: "text", delta: "Hello, world!" }]);
  });

  test("merges consecutive reasoning deltas into a single event", async () => {
    const events: ConversationEvent[] = [
      { type: "reasoning", delta: "first " },
      { type: "reasoning", delta: "second" },
    ];
    const out = await collect(coalesceTextDeltas(asyncIter(events), 1000));
    expect(out).toEqual([{ type: "reasoning", delta: "first second" }]);
  });

  test("type switch (text → reasoning) flushes the buffered batch", async () => {
    const events: ConversationEvent[] = [
      { type: "text", delta: "a" },
      { type: "text", delta: "b" },
      { type: "reasoning", delta: "x" },
    ];
    const out = await collect(coalesceTextDeltas(asyncIter(events), 1000));
    expect(out).toEqual([
      { type: "text", delta: "ab" },
      { type: "reasoning", delta: "x" },
    ]);
  });

  test("non-batchable events flush the buffer and pass through unchanged", async () => {
    const events: ConversationEvent[] = [
      { type: "text", delta: "a" },
      { type: "tool-call", name: "echo", input: {} },
      { type: "text", delta: "b" },
    ];
    const out = await collect(coalesceTextDeltas(asyncIter(events), 1000));
    expect(out).toEqual([
      { type: "text", delta: "a" },
      { type: "tool-call", name: "echo", input: {} },
      { type: "text", delta: "b" },
    ]);
  });

  test("flushes any buffered batch when the upstream stream ends", async () => {
    const events: ConversationEvent[] = [{ type: "text", delta: "trailing" }];
    const out = await collect(coalesceTextDeltas(asyncIter(events), 1000));
    expect(out).toEqual([{ type: "text", delta: "trailing" }]);
  });

  test("an empty stream produces no events", async () => {
    const out = await collect(coalesceTextDeltas(asyncIter<ConversationEvent>([]), 1000));
    expect(out).toEqual([]);
  });

  describe("with fake timers", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("flushes the buffer when tickMs elapses between deltas of the same type", async () => {
      // Use a hand-rolled generator so we can advance time between yields.
      const gate: { release: () => void } = { release: () => {} };
      async function* slow(): AsyncGenerator<ConversationEvent> {
        yield { type: "text", delta: "a" };
        await new Promise<void>((r) => {
          gate.release = r;
        });
        yield { type: "text", delta: "b" };
      }

      const out: ConversationEvent[] = [];
      const consumer = (async () => {
        for await (const ev of coalesceTextDeltas(slow(), 16)) out.push(ev);
      })();

      // Let the producer yield "a" and the consumer buffer it.
      await vi.advanceTimersByTimeAsync(0);
      // Advance past the tick window before "b" arrives.
      await vi.advanceTimersByTimeAsync(50);
      gate.release();
      await consumer;

      expect(out).toEqual([
        { type: "text", delta: "a" },
        { type: "text", delta: "b" },
      ]);
    });
  });
});
