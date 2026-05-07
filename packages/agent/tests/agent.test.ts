import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Capture the args streamText was called with so each test can assert wiring.
type StreamPart =
  | { type: "text-delta"; text?: string; delta?: string }
  | { type: "reasoning-delta"; text?: string; delta?: string }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "tool-result"; toolName: string; output: unknown }
  | { type: "tool-error"; toolName: string; error: unknown }
  | { type: "error"; error: unknown }
  | { type: "raw"; rawValue: unknown }
  | { type: "start-step"; request?: { body?: unknown } }
  | {
      type: "finish-step";
      usage?: { inputTokens?: number; outputTokens?: number };
      providerMetadata?: unknown;
    }
  | {
      type: "finish";
      finishReason: string;
      totalUsage?: { inputTokens?: number; outputTokens?: number };
      providerMetadata?: unknown;
    };

let lastStreamArgs: Record<string, unknown> | undefined;
let nextStreamParts: StreamPart[] = [];

vi.mock(import("ai"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    stepCountIs: ((n: number) => ({
      kind: "stepCountIs",
      n,
    })) as unknown as typeof actual.stepCountIs,
    streamText: ((args: Record<string, unknown>) => {
      lastStreamArgs = { ...args, messages: structuredClone(args.messages) };
      const parts = nextStreamParts;
      const fullStream = (async function* () {
        for (const p of parts) yield p;
      })();
      return { fullStream };
    }) as unknown as typeof actual.streamText,
  };
});

vi.mock("@ai-sdk/openai", () => {
  const responses = (id: string) => ({ provider: "openai", kind: "responses", id });
  const chat = (id: string) => ({ provider: "openai", kind: "chat", id });
  return {
    createOpenAI: (_opts: unknown) => Object.assign((id: string) => chat(id), { responses, chat }),
  };
});

vi.mock("@ai-sdk/fireworks", () => {
  const model = (id: string) => ({ provider: "fireworks", kind: "language", id });
  return {
    createFireworks: (_opts: unknown) =>
      Object.assign(model, {
        completionModel: (id: string) => ({ provider: "fireworks", kind: "completion", id }),
        embeddingModel: (id: string) => ({ provider: "fireworks", kind: "embedding", id }),
        image: (id: string) => ({ provider: "fireworks", kind: "image", id }),
      }),
  };
});

vi.mock("@cloudflare/codemode/ai", () => ({
  createCodeTool: (opts: unknown) => ({ kind: "codemode-tool", opts }),
}));

vi.mock("../src/api-mode.ts", () => ({
  detectApiMode: vi.fn(async () => "responses"),
}));

import { Agent } from "../src/agent.ts";
import { detectApiMode } from "../src/api-mode.ts";

const detectMock = vi.mocked(detectApiMode);

const stubExecutor = {
  name: "stub",
  execute: async () => ({ result: undefined }),
};

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("Agent", () => {
  const ENV_KEYS = [
    "SMOOV_API_MODE",
    "SMOOV_ZDR",
    "SMOOV_DEBUG",
    "SMOOV_PROVIDER",
    "SMOOV_FIREWORKS_THINKING",
    "SMOOV_FIREWORKS_THINKING_BUDGET_TOKENS",
    "SMOOV_FIREWORKS_REASONING_HISTORY",
  ] as const;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    lastStreamArgs = undefined;
    nextStreamParts = [];
    detectMock.mockReset();
    detectMock.mockResolvedValue("responses");
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("constructor stores options without I/O", () => {
    const agent = new Agent({ executor: stubExecutor });
    expect(agent).toBeInstanceOf(Agent);
  });

  test("yields a text event for each text-delta", async () => {
    nextStreamParts = [
      { type: "text-delta", delta: "hello " },
      { type: "text-delta", delta: "world" },
    ];
    const agent = new Agent({ executor: stubExecutor });
    const events = await collect(agent.run("hi"));
    expect(events).toEqual([
      { type: "text", delta: "hello " },
      { type: "text", delta: "world" },
    ]);
  });

  test("supports legacy text fields on text-delta stream parts", async () => {
    nextStreamParts = [{ type: "text-delta", text: "hello" }];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(events).toEqual([{ type: "text", delta: "hello" }]);
  });

  test("forwards reasoning, tool-call, tool-result, tool-error, error events", async () => {
    nextStreamParts = [
      { type: "reasoning-delta", delta: "thinking..." },
      { type: "tool-call", toolName: "echo", input: { text: "x" } },
      { type: "tool-result", toolName: "echo", output: { echoed: "x" } },
      { type: "tool-error", toolName: "echo", error: new Error("oops") },
      { type: "error", error: "boom" },
    ];
    const agent = new Agent({ executor: stubExecutor });
    const events = await collect(agent.run("hi"));
    expect(events).toEqual([
      { type: "reasoning", delta: "thinking..." },
      { type: "tool-call", name: "echo", input: { text: "x" } },
      { type: "tool-result", name: "echo", output: { echoed: "x" } },
      { type: "tool-error", name: "echo", error: "oops" },
      { type: "error", error: "boom" },
    ]);
  });

  test("stringifies non-Error tool-error values", async () => {
    nextStreamParts = [{ type: "tool-error", toolName: "t", error: "raw" }];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(events).toEqual([{ type: "tool-error", name: "t", error: "raw" }]);
  });

  test("emits token usage from finish stream parts", async () => {
    nextStreamParts = [
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 1200, outputTokens: 34 } },
    ];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(events).toEqual([{ type: "usage", inputTokens: 1200, outputTokens: 34 }]);
  });

  test("ignores stream parts of unknown type", async () => {
    nextStreamParts = [{ type: "start-step" }, { type: "finish-step" }];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(events).toEqual([]);
  });

  test("emits raw debug events when verbose run option is enabled", async () => {
    nextStreamParts = [
      { type: "tool-call", toolName: "echo", input: { text: "x" } },
      { type: "tool-result", toolName: "echo", output: { echoed: "x" } },
      { type: "tool-error", toolName: "echo", error: "bad" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 1, outputTokens: 2 },
        providerMetadata: { provider: "meta" },
      },
    ];
    const events = await collect(
      new Agent({ executor: stubExecutor }).run("hi", { verbose: true }),
    );
    expect(events).toEqual([
      { type: "debug", label: "raw-stream-part", data: nextStreamParts[0] },
      { type: "tool-call", name: "echo", input: { text: "x" } },
      { type: "debug", label: "raw-stream-part", data: nextStreamParts[1] },
      { type: "tool-result", name: "echo", output: { echoed: "x" } },
      { type: "debug", label: "raw-stream-part", data: nextStreamParts[2] },
      { type: "tool-error", name: "echo", error: "bad" },
      { type: "debug", label: "raw-stream-part", data: nextStreamParts[3] },
      { type: "usage", inputTokens: 1, outputTokens: 2 },
    ]);
  });

  test("does not emit raw debug events by default", async () => {
    nextStreamParts = [{ type: "tool-call", toolName: "echo", input: { text: "x" } }];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(events).toEqual([{ type: "tool-call", name: "echo", input: { text: "x" } }]);
  });

  test("emits an error when the stream ends with no text and finishReason='tool-calls' (step-limit punt)", async () => {
    nextStreamParts = [
      { type: "start-step" },
      { type: "tool-call", toolName: "codemode", input: { code: "..." } },
      { type: "tool-result", toolName: "codemode", output: { result: 1 } },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "finish-step" },
      { type: "finish", finishReason: "tool-calls" },
    ];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const errs = events.filter((e) => e.type === "error") as Array<{
      type: "error";
      error: string;
    }>;
    expect(errs.length).toBe(1);
    expect(errs[0].error).toMatch(/no response/i);
    expect(errs[0].error).toMatch(/tool-calls/);
    expect(errs[0].error).toMatch(/2 steps?/);
  });

  test("emits an error when the stream ends with no text and finishReason='length'", async () => {
    nextStreamParts = [{ type: "finish", finishReason: "length" }];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const errs = events.filter((e) => e.type === "error") as Array<{
      type: "error";
      error: string;
    }>;
    expect(errs.length).toBe(1);
    expect(errs[0].error).toMatch(/length/);
  });

  test("does not emit an extra error when the stream produced text", async () => {
    nextStreamParts = [
      { type: "text-delta", delta: "all done" },
      { type: "finish", finishReason: "tool-calls" },
    ];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  test("does not emit an extra error when finishReason is 'stop' (model chose silence)", async () => {
    nextStreamParts = [{ type: "finish", finishReason: "stop" }];
    const events = await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  test("appends user and assistant messages to history across turns", async () => {
    const agent = new Agent({ executor: stubExecutor });

    nextStreamParts = [{ type: "text-delta", delta: "a1" }];
    await collect(agent.run("u1"));
    expect(lastStreamArgs?.messages).toEqual([{ role: "user", content: "u1" }]);

    nextStreamParts = [{ type: "text-delta", delta: "a2" }];
    await collect(agent.run("u2"));
    expect(lastStreamArgs?.messages).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);
  });

  test("uses provider.responses(modelId) when api mode is 'responses'", async () => {
    detectMock.mockResolvedValue("responses");
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor, model: "my-model" }).run("hi"));
    expect(lastStreamArgs?.model).toEqual({
      provider: "openai",
      kind: "responses",
      id: "my-model",
    });
  });

  test("uses provider.chat(modelId) when api mode is 'chat'", async () => {
    detectMock.mockResolvedValue("chat");
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor, model: "my-model" }).run("hi"));
    expect(lastStreamArgs?.model).toEqual({ provider: "openai", kind: "chat", id: "my-model" });
  });

  test("uses the Fireworks language provider when SMOOV_PROVIDER=fireworks", async () => {
    process.env.SMOOV_PROVIDER = "fireworks";
    detectMock.mockRejectedValue(new Error("should not be called"));
    nextStreamParts = [];
    await collect(
      new Agent({
        executor: stubExecutor,
        model: "accounts/fireworks/routers/kimi-k2p5-turbo",
      }).run("hi"),
    );
    expect(lastStreamArgs?.model).toEqual({
      provider: "fireworks",
      kind: "language",
      id: "accounts/fireworks/routers/kimi-k2p5-turbo",
    });
    expect(detectMock).not.toHaveBeenCalled();
  });

  test("passes Fireworks thinking and reasoning-history options", async () => {
    process.env.SMOOV_PROVIDER = "fireworks";
    process.env.SMOOV_FIREWORKS_THINKING = "enabled";
    process.env.SMOOV_FIREWORKS_THINKING_BUDGET_TOKENS = "4096";
    process.env.SMOOV_FIREWORKS_REASONING_HISTORY = "interleaved";
    nextStreamParts = [];
    await collect(
      new Agent({ executor: stubExecutor, model: "accounts/fireworks/models/kimi-k2p5" }).run("hi"),
    );
    expect(lastStreamArgs?.providerOptions).toEqual({
      fireworks: {
        thinking: { type: "enabled", budgetTokens: 4096 },
        reasoningHistory: "interleaved",
      },
    });
  });

  test("defaults the model to gpt-5", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(lastStreamArgs).toBeDefined();
    expect((lastStreamArgs!.model as { id: string }).id).toBe("gpt-5");
  });

  test("respects SMOOV_API_MODE override (responses)", async () => {
    process.env.SMOOV_API_MODE = "responses";
    detectMock.mockRejectedValue(new Error("should not be called"));
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor, model: "m" }).run("hi"));
    expect(lastStreamArgs).toBeDefined();
    expect((lastStreamArgs!.model as { kind: string }).kind).toBe("responses");
    expect(detectMock).not.toHaveBeenCalled();
  });

  test("respects SMOOV_API_MODE override (chat)", async () => {
    process.env.SMOOV_API_MODE = "chat";
    detectMock.mockRejectedValue(new Error("should not be called"));
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor, model: "m" }).run("hi"));
    expect(lastStreamArgs).toBeDefined();
    expect((lastStreamArgs!.model as { kind: string }).kind).toBe("chat");
    expect(detectMock).not.toHaveBeenCalled();
  });

  test("forces chat mode when SMOOV_ZDR=true", async () => {
    process.env.SMOOV_ZDR = "true";
    detectMock.mockRejectedValue(new Error("should not be called"));
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(lastStreamArgs).toBeDefined();
    expect((lastStreamArgs!.model as { kind: string }).kind).toBe("chat");
    expect(detectMock).not.toHaveBeenCalled();
  });

  test("sets providerOptions.openai.store=false when ZDR is on", async () => {
    process.env.SMOOV_ZDR = "1";
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const po = lastStreamArgs?.providerOptions as { openai: { store: boolean } };
    expect(po.openai.store).toBe(false);
  });

  test("sets providerOptions.openai.store=true when ZDR is explicitly off", async () => {
    process.env.SMOOV_ZDR = "false";
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const po = lastStreamArgs?.providerOptions as { openai: { store: boolean } };
    expect(po.openai.store).toBe(true);
  });

  test("requests OpenAI reasoning summaries in verbose mode", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi", { verbose: true }));
    const po = lastStreamArgs?.providerOptions as {
      openai: { reasoningSummary?: string };
    };
    expect(po.openai.reasoningSummary).toBe("auto");
  });

  test("requests OpenAI reasoning summaries when showReasoning is enabled", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi", { showReasoning: true }));
    const po = lastStreamArgs?.providerOptions as {
      openai: { reasoningSummary?: string };
    };
    expect(po.openai.reasoningSummary).toBe("auto");
  });

  test("requests raw provider chunks in verbose mode", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi", { verbose: true }));
    expect(lastStreamArgs?.includeRawChunks).toBe(true);
  });

  test("requests raw provider chunks when showReasoning is enabled", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi", { showReasoning: true }));
    expect(lastStreamArgs?.includeRawChunks).toBe(true);
  });

  test("does not request raw provider chunks by default", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(lastStreamArgs?.includeRawChunks).toBe(false);
  });

  test("surfaces OpenAI-compatible raw reasoning_content chunks as reasoning in verbose mode", async () => {
    nextStreamParts = [
      {
        type: "raw",
        rawValue: { choices: [{ delta: { reasoning_content: "thinking from provider" } }] },
      },
    ];
    const events = await collect(
      new Agent({ executor: stubExecutor }).run("hi", { verbose: true }),
    );
    expect(events).toEqual([
      { type: "debug", label: "raw-stream-part", data: nextStreamParts[0] },
      { type: "reasoning", delta: "thinking from provider" },
    ]);
  });

  test("surfaces raw reasoning_content without debug records when showReasoning is enabled", async () => {
    nextStreamParts = [
      {
        type: "raw",
        rawValue: { choices: [{ delta: { reasoning_content: "thinking from provider" } }] },
      },
    ];
    const events = await collect(
      new Agent({ executor: stubExecutor }).run("hi", { showReasoning: true }),
    );
    expect(events).toEqual([{ type: "reasoning", delta: "thinking from provider" }]);
  });

  test("does not request OpenAI reasoning summaries by default", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const po = lastStreamArgs?.providerOptions as {
      openai: { reasoningSummary?: string };
    };
    expect(po.openai.reasoningSummary).toBeUndefined();
  });

  test("uses the supplied system prompt", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor, system: "custom-system" }).run("hi"));
    expect(lastStreamArgs?.system).toBe("custom-system");
  });

  test("uses a default system prompt when none is supplied", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    expect(lastStreamArgs?.system).toMatch(/smoovcode/i);
  });

  test("default system prompt teaches the model about codemode result shapes and console capture", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const sys = lastStreamArgs?.system as string;
    // Must warn against treating tool results as bare arrays (the .matches gotcha).
    expect(sys).toMatch(/\.length|matches/i);
    // Must mention that console output is captured (so the model uses console.log to introspect).
    expect(sys).toMatch(/console/i);
  });

  test("uses a 30-step budget by default", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const stop = lastStreamArgs?.stopWhen as { kind: string; n: number };
    expect(stop.kind).toBe("stepCountIs");
    expect(stop.n).toBe(30);
  });

  test("registers a 'codemode' tool wired to the executor", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const tools = lastStreamArgs?.tools as {
      codemode: { kind: string; opts: { executor: unknown } };
    };
    expect(tools.codemode.kind).toBe("codemode-tool");
    expect(tools.codemode.opts.executor).toBe(stubExecutor);
  });

  test("registers `write` and `edit` as top-level AI SDK tools (alongside codemode)", async () => {
    // Writes are user-visible mutations: each one is a discrete tool-call so
    // the harness can render diffs / approvals cleanly. They live outside
    // codemode by design.
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const tools = lastStreamArgs?.tools as Record<string, unknown>;
    expect(tools.write).toBeDefined();
    expect(tools.edit).toBeDefined();
  });

  test("passes read-style tools and host capabilities into codemode", async () => {
    // The split: reads stay inside codemode (orchestration-friendly), writes
    // are top-level. If a write ever leaks into codemode, the model can hide
    // mutations inside a TS scope and the harness loses visibility.
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const tools = lastStreamArgs?.tools as {
      codemode: { opts: { tools: Array<{ name?: string; tools: Record<string, unknown> }> } };
    };
    const codemodeProviders = tools.codemode.opts.tools;
    const defaultProvider = codemodeProviders.find((p) => p.name === undefined);
    const shProvider = codemodeProviders.find((p) => p.name === "sh");
    const ghProvider = codemodeProviders.find((p) => p.name === "gh");
    const gitProvider = codemodeProviders.find((p) => p.name === "git");
    expect(Object.keys(defaultProvider?.tools ?? {}).sort()).toEqual(["astGrep"]);
    expect(defaultProvider?.tools.bash).toBeUndefined();
    expect(shProvider?.tools.rg).toBeDefined();
    expect(shProvider?.tools.rm).toBeUndefined();
    expect(ghProvider?.tools.issue_view).toBeDefined();
    expect(gitProvider?.tools.status).toBeDefined();
    for (const provider of codemodeProviders) {
      expect(provider.tools.write).toBeUndefined();
      expect(provider.tools.edit).toBeUndefined();
    }
  });

  test("system prompt explains the read-vs-write split", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const sys = lastStreamArgs?.system as string;
    // Both surfaces are named so the model knows where each call belongs.
    expect(sys).toMatch(/codemode/i);
    expect(sys).toMatch(/\bwrite\b/);
    expect(sys).toMatch(/\bedit\b/);
    expect(sys).toMatch(/executor is not a mutation boundary/i);
  });

  test("system prompt teaches sh commands and does not mention codemode.bash", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const sys = lastStreamArgs?.system as string;

    expect(sys).toMatch(/sh\.rg/);
    expect(sys).toMatch(/sh\.cat/);
    expect(sys).not.toMatch(/codemode\.bash/);
  });

  test("does not expose plan/edit mode controls", async () => {
    nextStreamParts = [];
    await collect(new Agent({ executor: stubExecutor }).run("hi"));
    const sys = lastStreamArgs?.system as string;
    const tools = lastStreamArgs?.tools as Record<string, unknown>;
    expect(sys).not.toMatch(/PLAN MODE|edit mode|plan mode/);
    expect(tools.write).toBeDefined();
    expect(tools.edit).toBeDefined();
  });
});
