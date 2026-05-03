import type { AgentEvent } from "@smoovcode/agent";
import type { Block } from "@smoovcode/ui-core";
import { render } from "ink-testing-library";
import { createElement } from "react";
import { describe, expect, test, vi } from "vite-plus/test";
import { BlockView } from "../src/block-view.tsx";
import { LiveTurn } from "../src/live-turn.tsx";

interface FakeAgent {
  run: (msg: string, opts?: { signal?: AbortSignal }) => AsyncIterable<AgentEvent>;
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
  // React 19 + Ink 7 schedule effects more lazily than 18, so give the
  // useMountEffect inside useAgentSession a few macrotask ticks to start
  // the agent stream before we assert.
  await new Promise((r) => setTimeout(r, 100));
}

describe("LiveTurn", () => {
  const SPINNER_FRAME = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

  test("renders a working spinner while the turn is in progress", () => {
    // Suspend the iterator forever — turn never reaches done.
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        await never;
        yield { type: "text", delta: "" };
      },
    };
    const { lastFrame } = render(
      createElement(LiveTurn, {
        agent,
        message: "hello",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("working");
    expect(frame).not.toContain("thinking");
    expect(SPINNER_FRAME.test(frame)).toBe(true);
  });

  test("animates the working indicator in the live bottom-pane region", async () => {
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        await never;
        yield { type: "text", delta: "" };
      },
    };
    const { lastFrame } = render(
      createElement(LiveTurn, {
        agent,
        message: "hello",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    const first = lastFrame() ?? "";
    await new Promise((r) => setTimeout(r, 180));
    expect(lastFrame() ?? "").not.toBe(first);
  });

  test("renders elapsed time and token counts next to the working label", async () => {
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        yield { type: "usage", inputTokens: 1200, outputTokens: 34 };
        await never;
      },
    };
    const { lastFrame } = render(
      createElement(LiveTurn, {
        agent,
        message: "ping",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("working");
    expect(frame).toContain("0s");
    expect(frame).toContain("34 out");
    expect(frame).toContain("1.2k in");
  });

  test("does not render streaming text content live", async () => {
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        yield { type: "text", delta: "Hi" };
        yield { type: "text", delta: ", there!" };
        await never;
      },
    };
    const { lastFrame } = render(
      createElement(LiveTurn, {
        agent,
        message: "ping",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Hi, there!");
    expect(frame).toContain("working");
    expect(frame).not.toContain("thinking:");
  });

  test("does not render running tool-calls in the live bottom-pane region", async () => {
    const never = new Promise<void>(() => {});
    const agent: FakeAgent = {
      async *run() {
        yield { type: "tool-call", name: "codemode", input: { code: "1" } };
        yield { type: "tool-call", name: "bash", input: { argv: ["ls"] } };
        await never;
      },
    };
    const { lastFrame } = render(
      createElement(LiveTurn, {
        agent,
        message: "go",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("working");
    expect(frame).not.toContain("[codemode]");
    expect(frame).not.toContain("[bash]");
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
      createElement(LiveTurn, {
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
      createElement(LiveTurn, {
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

  test("keeps the working row mounted until App removes the pending turn", async () => {
    const agent = scriptedAgent([{ type: "text", delta: "done" }]);
    const { lastFrame } = render(
      createElement(LiveTurn, {
        agent,
        message: "go",
        onBlockFinalize: () => {},
        onTurnDone: () => {},
      }),
    );
    await flush();
    expect(lastFrame() ?? "").toContain("working");
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
      createElement(LiveTurn, {
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
    const { lastFrame } = render(
      createElement(BlockView, { block: emitted, expandedCodemode: true }),
    );
    expect(lastFrame() ?? "").toContain("\u001B[");
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
      createElement(LiveTurn, {
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
