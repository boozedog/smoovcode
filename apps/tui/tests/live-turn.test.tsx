import type { AgentEvent } from "@smoovcode/agent";
import type { Block } from "@smoovcode/ui-core";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test, vi } from "vite-plus/test";
import { LiveTurn } from "../src/live-turn.tsx";

interface FakeAgent {
  run: (msg: string, signal?: AbortSignal) => AsyncIterable<AgentEvent>;
}

function scriptedAgent(events: AgentEvent[]): FakeAgent {
  return {
    async *run() {
      for (const e of events) {
        await Promise.resolve();
        yield e;
      }
    },
  };
}

async function flush() {
  // Drain microtasks + a setTimeout cycle so the async iterator can yield.
  await new Promise((r) => setTimeout(r, 20));
}

describe("LiveTurn", () => {
  test("does not render anything before any blocks have arrived", () => {
    const agent = scriptedAgent([]);
    const { lastFrame } = render(
      React.createElement(LiveTurn, {
        agent,
        message: "hello",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    expect(lastFrame()?.trim()).toBe("");
  });

  test("renders a streaming text block live, in the live region", async () => {
    // Suspend the iterator after the text deltas so the stream never reaches
    // turn-end during the test — the text block stays in `streaming` and
    // therefore stays in the live region.
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        yield { type: "text", delta: "Hi" };
        yield { type: "text", delta: ", there!" };
        await never;
      },
    };
    const { lastFrame } = render(
      React.createElement(LiveTurn, {
        agent,
        message: "ping",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    await flush();
    expect(lastFrame()).toContain("Hi, there!");
  });

  test("emits each finalized block via onBlockFinalize", async () => {
    const agent = scriptedAgent([
      { type: "text", delta: "before" },
      { type: "tool-call", name: "echo", input: { x: 1 } },
      { type: "tool-result", name: "echo", output: { ok: true } },
      { type: "text", delta: "after" },
    ]);
    const onBlockFinalize = vi.fn<(b: Block, turnId: number) => void>();
    render(
      React.createElement(LiveTurn, {
        agent,
        message: "go",
        onBlockFinalize,
        onTurnDone: () => {},
      }),
    );
    await flush();
    const kinds = onBlockFinalize.mock.calls.map(([b]) => b.kind);
    expect(kinds).toEqual(["text", "tool-call", "text"]);
    // The middle block is the completed tool-call, with output preserved.
    const tc = onBlockFinalize.mock.calls[1][0];
    if (tc.kind !== "tool-call") throw new Error("expected tool-call");
    expect(tc.status).toBe("done");
    expect(tc.output).toEqual({ ok: true });
  });

  test("calls onTurnDone after the stream ends", async () => {
    const agent = scriptedAgent([{ type: "text", delta: "done" }]);
    const onTurnDone = vi.fn<(turnId: number) => void>();
    render(
      React.createElement(LiveTurn, {
        agent,
        message: "go",
        onBlockFinalize: () => {},
        onTurnDone,
      }),
    );
    await flush();
    expect(onTurnDone).toHaveBeenCalledTimes(1);
    expect(onTurnDone.mock.calls[0][0]).toBe(0);
  });

  test("calls onError when the agent throws", async () => {
    const agent: FakeAgent = {
      // eslint-disable-next-line require-yield
      async *run() {
        throw new Error("kaboom");
      },
    };
    const onError = vi.fn<(e: unknown) => void>();
    render(
      React.createElement(LiveTurn, {
        agent,
        message: "oops",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
        onError,
      }),
    );
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("kaboom");
  });
});
