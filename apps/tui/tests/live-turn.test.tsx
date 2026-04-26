import type { AgentEvent } from "@smoovcode/agent";
import type { Turn } from "@smoovcode/ui-core";
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
  test("renders the user prompt immediately on mount", () => {
    const agent = scriptedAgent([]);
    const { lastFrame } = render(
      React.createElement(LiveTurn, { agent, message: "hello", onDone: () => {} }),
    );
    expect(lastFrame()).toContain("> hello");
  });

  test("streams text deltas into the rendered frame", async () => {
    const agent = scriptedAgent([
      { type: "text", delta: "Hi" },
      { type: "text", delta: ", there!" },
    ]);
    const onDone = vi.fn<(t: Turn) => void>();
    const { lastFrame } = render(React.createElement(LiveTurn, { agent, message: "ping", onDone }));
    await flush();
    expect(lastFrame()).toContain("Hi, there!");
  });

  test("calls onDone with the finalized turn when the stream ends", async () => {
    const agent = scriptedAgent([{ type: "text", delta: "done" }]);
    const onDone = vi.fn<(t: Turn) => void>();
    render(React.createElement(LiveTurn, { agent, message: "go", onDone }));
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
    const turn = onDone.mock.calls[0][0];
    expect(turn.text).toBe("done");
    expect(turn.status).toBe("done");
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
        onDone: () => {},
        onError,
      }),
    );
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("kaboom");
  });
});
