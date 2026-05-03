import type { AgentEvent } from "@smoovcode/agent";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, test, vi } from "vite-plus/test";
import { useAgentSession } from "../src/use-agent-session.ts";

interface FakeAgent {
  run: (msg: string, opts?: { signal?: AbortSignal }) => AsyncIterable<AgentEvent>;
}

function makeAgent(events: AgentEvent[], onAbort?: () => void): FakeAgent {
  return {
    async *run(_msg: string, opts?: { signal?: AbortSignal }) {
      for (const e of events) {
        if (opts?.signal?.aborted) {
          onAbort?.();
          return;
        }
        await Promise.resolve();
        yield e;
      }
    },
  };
}

interface Captured<T> {
  last: T | null;
}

function harnessHook<T>(useHook: () => T): {
  renderer: TestRenderer.ReactTestRenderer;
  captured: Captured<T>;
} {
  const captured: Captured<T> = { last: null };
  const Probe = () => {
    captured.last = useHook();
    return null;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(createElement(Probe));
  });
  return { renderer, captured };
}

describe("useAgentSession", () => {
  test("starts a streaming turn carrying the user message on mount", () => {
    const agent = makeAgent([]);
    const { captured } = harnessHook(() => useAgentSession({ agent, message: "hi" }));
    expect(captured.last?.conversation.live?.userMessage).toBe("hi");
    expect(captured.last?.conversation.live?.status).toBe("streaming");
    expect(captured.last?.done).toBe(false);
    expect(captured.last?.error).toBeNull();
  });

  test("feeds incoming agent events into the conversation reducer", async () => {
    const agent = makeAgent([
      { type: "text", delta: "hello" },
      { type: "text", delta: " world" },
    ]);
    const { captured } = harnessHook(() => useAgentSession({ agent, message: "hi" }));
    await act(async () => {
      // let the async iterator drain
      await new Promise((r) => setTimeout(r, 20));
    });
    const turn = captured.last?.conversation.live ?? captured.last?.conversation.finalized.at(-1);
    expect(turn?.blocks).toHaveLength(1);
    const b = turn?.blocks[0];
    if (!b || b.kind !== "text") throw new Error("expected single text block");
    expect(b.text).toBe("hello world");
    expect(captured.last?.done).toBe(true);
  });

  test("aborts the agent on unmount via the AbortSignal", async () => {
    const onAbort = vi.fn();
    const agent: FakeAgent = {
      async *run(_msg, opts) {
        // Long-running stream that yields and waits forever.
        yield { type: "text", delta: "first" };
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener("abort", () => {
            onAbort();
            resolve();
          });
        });
      },
    };
    const { renderer } = harnessHook(() => useAgentSession({ agent, message: "hi" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      renderer.unmount();
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  test("captures errors thrown by the agent into the returned `error` field", async () => {
    const agent: FakeAgent = {
      // eslint-disable-next-line require-yield
      async *run() {
        throw new Error("boom");
      },
    };
    const { captured } = harnessHook(() => useAgentSession({ agent, message: "x" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect((captured.last?.error as Error | null)?.message).toBe("boom");
  });
});
