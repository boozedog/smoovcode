import type { AgentEvent } from "@smoovcode/agent";
import type { Block } from "@smoovcode/ui-core";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test, vi } from "vite-plus/test";
import { BlockView } from "../src/block-view.tsx";
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
  const SPINNER_FRAME = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

  test("renders a thinking spinner while the turn is in progress", () => {
    // Suspend the iterator forever — turn never reaches done.
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        await never;
      },
    };
    const { lastFrame } = render(
      React.createElement(LiveTurn, {
        agent,
        message: "hello",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("thinking");
    expect(SPINNER_FRAME.test(frame)).toBe(true);
  });

  test("does not render streaming text content live", async () => {
    // Streaming text is not shown live — it only appears in scrollback once
    // the block is finalized. While the turn runs, the live region is just a
    // bounded spinner. Use the CLI if you want token-by-token streaming.
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
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Hi, there!");
    expect(frame).toContain("thinking");
  });

  test("renders one indented line per running tool-call, with the tool name", async () => {
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        yield { type: "tool-call", name: "codemode", input: { code: "1" } };
        yield { type: "tool-call", name: "bash", input: { argv: ["ls"] } };
        await never;
      },
    };
    const { lastFrame } = render(
      React.createElement(LiveTurn, {
        agent,
        message: "go",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[codemode]");
    expect(frame).toContain("[bash]");
    // Tool-call inputs must NOT leak into the live region — that's what
    // overflows the terminal and produces duplicate scrollback.
    expect(frame).not.toContain("argv");
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

  test("pre-warms syntax highlighting before emitting a block, so a Static-style synchronous re-render shows ANSI", async () => {
    // This is the bug behind "blocks aren't pretty in scrollback": Ink's
    // <Static> renders each item exactly once, so any async highlight that
    // resolves after the Static commit never reaches the terminal. LiveTurn
    // must finish highlighting *before* it emits the block.
    const agent = scriptedAgent([
      {
        type: "tool-call",
        name: "codemode",
        input: { code: 'const greeting = "hello";\nconsole.log(greeting);' },
      },
      { type: "tool-result", name: "codemode", output: { result: { ok: true } } },
    ]);
    let emitted: Block | null = null;
    render(
      React.createElement(LiveTurn, {
        agent,
        message: "go",
        onBlockFinalize: (b: Block) => {
          if (emitted === null) emitted = b;
        },
        onTurnDone: () => {},
      }),
    );
    await flush();
    if (emitted === null) throw new Error("expected a block to be emitted");
    // Render the emitted block and read the *first* frame — no extra waits,
    // mirroring what <Static> does (one-shot render, no re-render).
    const { lastFrame } = render(React.createElement(BlockView, { block: emitted }));
    expect(lastFrame() ?? "").toMatch(/\x1b\[/);
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
