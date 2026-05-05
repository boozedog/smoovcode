import { stdout } from "node:process";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Scripted readline answers feed user inputs into runLoop, then throw
// ERR_USE_AFTER_CLOSE to exit cleanly (matches the termination path).
let scriptedAnswers: string[] = [];
let questionPrompts: string[] = [];
const readlineMocks = vi.hoisted(() => ({
  rlClose: vi.fn(),
  createInterface: vi.fn(),
}));

vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: readlineMocks.createInterface,
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
  let writeSpy: { mockRestore: () => void } | undefined;

  beforeEach(() => {
    writes = [];
    writeSpy = vi.spyOn(stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as unknown as typeof stdout.write);
    scriptedAnswers = [];
    questionPrompts = [];
    scriptedEventsByTurn = [];
    agentThrowOn = undefined;
    agentThrowValue = new Error("agent-failure");
    agentRunCalls.length = 0;
    agentConstructorOpts.length = 0;
    readlineMocks.rlClose.mockClear();
    readlineMocks.createInterface.mockClear();
    readlineMocks.createInterface.mockImplementation(() => ({
      question: vi.fn(async (prompt: string) => {
        questionPrompts.push(prompt);
        if (scriptedAnswers.length === 0) {
          const err = new Error("rl closed") as NodeJS.ErrnoException;
          err.code = "ERR_USE_AFTER_CLOSE";
          throw err;
        }
        return scriptedAnswers.shift() as string;
      }),
      close: readlineMocks.rlClose,
    }));
  });

  afterEach(() => {
    writeSpy?.mockRestore();
  });

  test("prints the banner with the executor name on startup", async () => {
    await runLoop(stubExecutor);
    expect(writes.join("")).toMatch(/smoovcode \(backend: stub, root: .+\) — ctrl-d to exit/);
  });

  test("keeps one rudimentary readline interface open for CLI input", async () => {
    await runLoop(stubExecutor);
    expect(readlineMocks.createInterface).toHaveBeenCalledTimes(1);
    expect(readlineMocks.rlClose).toHaveBeenCalledTimes(1);
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
    expect(out).toContain("\u001B[2mthinking: first second\u001B[0m\nanswer");
  });

  test("formats tool-call events with name and JSON input", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [[{ type: "tool-call", name: "echo", input: { text: "hi" } }]];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain(`[echo] {"text":"hi"}`);
  });

  test("prints full raw tool-result payloads that have a `result` field", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [
      [
        {
          type: "tool-result",
          name: "codemode",
          output: {
            result: { echoed: "x" },
            logs: ["log line"],
            metrics: { toolCalls: 1 },
            nestedToolCalls: [{ provider: "sh", name: "pwd", status: "done" }],
          },
        },
      ],
    ];
    await runLoop(stubExecutor);
    const out = writes.join("");
    expect(out).toContain(`[codemode] → {\n`);
    expect(out).toContain(`"result": {`);
    expect(out).toContain(`"echoed": "x"`);
    expect(out).toContain(`"logs": [`);
    expect(out).toContain(`"metrics": {`);
    expect(out).toContain(`"nestedToolCalls": [`);
  });

  test("passes through tool-result payloads without a `result` field", async () => {
    scriptedAnswers = ["hi"];
    scriptedEventsByTurn = [[{ type: "tool-result", name: "t", output: { foo: "bar" } }]];
    await runLoop(stubExecutor);
    expect(writes.join("")).toContain(`[t] → {\n  "foo": "bar"\n}`);
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
    expect(agentConstructorOpts[0]).not.toHaveProperty("approveHost");
  });

  test("omits model on the Agent when none is supplied", async () => {
    scriptedAnswers = [];
    await runLoop(stubExecutor);
    expect(agentConstructorOpts[0]).toMatchObject({ executor: stubExecutor, model: undefined });
    expect(agentConstructorOpts[0]).not.toHaveProperty("approveHost");
  });

  test("prompts for single-line input with readline", async () => {
    scriptedAnswers = ["hello"];
    scriptedEventsByTurn = [[]];
    await runLoop(stubExecutor);
    expect(questionPrompts).toContain("\n> ");
    expect(agentRunCalls).toEqual(["hello"]);
  });

  test("exits cleanly when readline aborts after ctrl-c", async () => {
    readlineMocks.createInterface.mockImplementation(() => ({
      question: vi.fn(async () => {
        const err = new Error("Aborted with Ctrl+C") as NodeJS.ErrnoException;
        err.code = "ABORT_ERR";
        throw err;
      }),
      close: readlineMocks.rlClose,
    }));

    await expect(runLoop(stubExecutor)).resolves.toBeUndefined();
    expect(readlineMocks.rlClose).toHaveBeenCalledTimes(1);
  });
});
