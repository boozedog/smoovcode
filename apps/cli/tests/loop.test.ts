import { stdout } from "node:process";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Multi-line input is mocked via a hoisted mock that replaces the readMultiLine
// function. This feeds scripted user inputs into runLoop's input calls,
// then throws ERR_USE_AFTER_CLOSE to exit cleanly (matches the termination path).
let scriptedAnswers: string[] = [];
const rlClose = vi.fn();

// Hoisted mock for readMultiLine - needs to be defined before imports
const mockReadMultiLine = vi.hoisted(() =>
  vi.fn(async () => {
    if (scriptedAnswers.length === 0) {
      const err = new Error("rl closed") as NodeJS.ErrnoException;
      err.code = "ERR_USE_AFTER_CLOSE";
      throw err;
    }
    return scriptedAnswers.shift() as string;
  }),
);

vi.mock("../src/readMultiLine.js", () => ({
  readMultiLine: mockReadMultiLine,
}));

vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: () => ({
      question: vi.fn(async () => {
        // This is only used for approval prompts
        if (scriptedAnswers.length === 0) {
          const err = new Error("rl closed") as NodeJS.ErrnoException;
          err.code = "ERR_USE_AFTER_CLOSE";
          throw err;
        }
        return scriptedAnswers.shift() as string;
      }),
      close: rlClose,
    }),
  },
}));

// Replace Agent with a stub whose run() yields a scripted event sequence per
// turn. agentRunCalls captures the messages passed in, in order.
type ScriptedEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown }
  | { type: "tool-error"; name: string; error: string }
  | { type: "error"; error: string };

let scriptedEventsByTurn: ScriptedEvent[][] = [];
let agentThrowOn: number | undefined;
let agentThrowValue: unknown = new Error("agent-failure");
const agentRunCalls: string[] = [];
const agentConstructorOpts: unknown[] = [];

vi.mock("@smoovcode/agent", () => {
  return {
    Agent: class {
      private turn = 0;
      constructor(public opts: unknown) {
        agentConstructorOpts.push(opts);
      }
      async *run(msg: string) {
        agentRunCalls.push(msg);
        const idx = this.turn++;
        if (agentThrowOn === idx) throw agentThrowValue;
        const events = scriptedEventsByTurn[idx] ?? [];
        for (const e of events) yield e;
      }
    },
    findProjectRoot: (start: string) => start,
  };
});

import { runLoop } from "../src/loop.ts";

const stubExecutor = { name: "stub", execute: async () => ({ result: undefined }) };

describe("runLoop", () => {
  let writes: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    writes = [];
    writeSpy = vi.spyOn(stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as unknown as typeof stdout.write);
    scriptedAnswers = [];
    scriptedEventsByTurn = [];
    agentThrowOn = undefined;
    agentThrowValue = new Error("agent-failure");
    agentRunCalls.length = 0;
    agentConstructorOpts.length = 0;
    rlClose.mockClear();
    mockReadMultiLine.mockClear();
  });

  afterEach(() => {
    writeSpy?.mockRestore();
  });

  test("prints the banner with the executor name on startup", async () => {
    await runLoop(stubExecutor);
    expect(writes.join("")).toMatch(/smoovcode \(backend: stub, root: .+\) — ctrl-d to exit/);
  });

  test("closes the readline interface in the finally block", async () => {
    await runLoop(stubExecutor);
    expect(rlClose).toHaveBeenCalledTimes(1);
  });

  test("forwards each user message to agent.run", async () => {
    scriptedAnswers = ["hello", "second"];
    scriptedEventsByTurn = [[], []];
    await runLoop(stubExecutor);
    expect(agentRunCalls).toEqual(["hello", "second"]);
  });

  test("skips empty / whitespace-only input without calling the agent", async () => {
    scriptedAnswers = ["", "   ", "real"];
    scriptedEventsByTurn = [[]];
    await runLoop(stubExecutor);
    expect(agentRunCalls).toEqual(["real"]);
  });

  test("writes text deltas to stdout", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [
      [
        { type: "text", delta: "Hello, " },
        { type: "text", delta: "world!" },
      ],
    ];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain("Hello, world!");
  });

  test("wraps reasoning deltas in dim ANSI codes and resets when reasoning ends", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [
      [
        { type: "reasoning", delta: "first " },
        { type: "reasoning", delta: "second" },
        { type: "text", delta: "answer" },
      ],
    ];
    await runLoop(stubExecutor);
    const out = writes.join("");
    // Dim opens once, contains both reasoning chunks, then resets before text.
    expect(out).toMatch(/\x1b\[2mthinking: first second\x1b\[0m\nanswer/);
  });

  test("formats tool-call events with name and JSON input", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [[{ type: "tool-call", name: "echo", input: { text: "hi" } }]];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain(`[echo] {"text":"hi"}`);
  });

  test("compacts tool-result payloads that have a `result` field", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [
      [{ type: "tool-result", name: "echo", output: { result: { echoed: "x" } } }],
    ];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain(`[echo] → {"echoed":"x"}`);
  });

  test("passes through tool-result payloads without a `result` field", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [[{ type: "tool-result", name: "t", output: { foo: "bar" } }]];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain(`[t] → {"foo":"bar"}`);
  });

  test("formats tool-error events with the ✗ marker", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [[{ type: "tool-error", name: "t", error: "bad" }]];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain("[t] ✗ bad");
  });

  test("prints stream-level errors with the [error] tag", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [[{ type: "error", error: "oops" }]];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain("[error] oops");
  });

  test("recovers from an agent throw and continues to the next prompt", async () => {
    scriptedAnswers = ["first", "second"];
    scriptedEventsByTurn = [[], [{ type: "text", delta: "ok" }]];
    agentThrowOn = 0;
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain("[error] agent-failure");
    expect(agentRunCalls).toEqual(["first", "second"]);
    expect(writes.join("")).toContain("ok");
  });

  test("stringifies non-Error agent throws", async () => {
    scriptedAnswers = ["x"];
    scriptedEventsByTurn = [[]];
    agentThrowOn = 0;
    agentThrowValue = "string-failure";
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain("[error] string-failure");
  });

  test("passes executor and model through to the Agent constructor", async () => {
    scriptedAnswers = [];
    await runLoop(stubExecutor, "gpt-x");
    expect(agentConstructorOpts).toHaveLength(1);
    expect(agentConstructorOpts[0]).toMatchObject({ executor: stubExecutor, model: "gpt-x" });
    expect(typeof (agentConstructorOpts[0] as { approveHost?: unknown }).approveHost).toBe(
      "function",
    );
  });

  test("omits model on the Agent when none is supplied", async () => {
    scriptedAnswers = [];
    await runLoop(stubExecutor);
    expect(agentConstructorOpts[0]).toMatchObject({ executor: stubExecutor, model: undefined });
    expect(typeof (agentConstructorOpts[0] as { approveHost?: unknown }).approveHost).toBe(
      "function",
    );
  });

  test("supports multi-line input from readMultiLine", async () => {
    // Simulate a multi-line input being returned by readMultiLine
    mockReadMultiLine.mockResolvedValueOnce("line 1\nline 2");
    mockReadMultiLine.mockRejectedValueOnce(
      Object.assign(new Error("rl closed"), { code: "ERR_USE_AFTER_CLOSE" }),
    );
    scriptedEventsByTurn = [[]];
    await runLoop(stubExecutor);
    expect(agentRunCalls).toEqual(["line 1\nline 2"]);
  });
});
