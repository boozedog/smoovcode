import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { ResolvedProvider, ToolFns } from "../src/executor.ts";
import { LocalExecutor } from "../src/executors/local.ts";

const trivial: ResolvedProvider[] = [{ name: "codemode", fns: { ping: async () => "pong" } }];

describe("LocalExecutor", () => {
  test("has the name 'local'", () => {
    expect(new LocalExecutor().name).toBe("local");
  });

  test("returns the awaited result", async () => {
    const r = await new LocalExecutor().execute("async () => 42", trivial);
    expect(r.error).toBeUndefined();
    expect(r.result).toBe(42);
  });

  test("captures console.log into logs", async () => {
    const r = await new LocalExecutor().execute(
      `async () => { console.log("hi", 1); return "done"; }`,
      trivial,
    );
    expect(r.result).toBe("done");
    expect(r.logs).toEqual(["hi 1"]);
  });

  test("captures console.error into logs", async () => {
    const r = await new LocalExecutor().execute(
      `async () => { console.error("bad"); return null; }`,
      trivial,
    );
    expect(r.logs).toEqual(["bad"]);
  });

  test("returns error when code throws", async () => {
    const r = await new LocalExecutor().execute(
      `async () => { throw new Error("boom"); }`,
      trivial,
    );
    expect(r.result).toBeUndefined();
    expect(r.error).toBe("boom");
  });

  test("returns error message for non-Error throws", async () => {
    const r = await new LocalExecutor().execute(`async () => { throw "string-throw"; }`, trivial);
    expect(r.error).toBe("string-throw");
  });

  test("returns error when code is syntactically invalid", async () => {
    const r = await new LocalExecutor().execute("not a function", trivial);
    expect(r.result).toBeUndefined();
    expect(r.error).toBeDefined();
  });

  test("preserves logs even when code throws", async () => {
    const r = await new LocalExecutor().execute(
      `async () => { console.log("before"); throw new Error("fail"); }`,
      trivial,
    );
    expect(r.error).toBe("fail");
    expect(r.logs).toEqual(["before"]);
  });

  test("exposes provider namespaces as bindings in scope", async () => {
    const providers: ResolvedProvider[] = [
      { name: "alpha", fns: { hi: async () => "alpha-hi" } },
      { name: "beta", fns: { hi: async () => "beta-hi" } },
    ];
    const r = await new LocalExecutor().execute(
      `async () => ({ a: await alpha.hi(), b: await beta.hi() })`,
      providers,
    );
    expect(r.result).toEqual({ a: "alpha-hi", b: "beta-hi" });
  });

  test("accepts a flat ToolFns record (legacy codemode shape)", async () => {
    const fns: ToolFns = { hi: async () => "flat" };
    const r = await new LocalExecutor().execute(`async () => await codemode.hi()`, fns);
    expect(r.result).toBe("flat");
  });

  test("reports tool-call metrics for calls made inside codemode", async () => {
    const providers: ResolvedProvider[] = [
      {
        name: "codemode",
        fns: {
          echo: async (a: unknown) => ({ echoed: a }),
          ping: async () => "pong",
        },
      },
    ];
    const r = await new LocalExecutor().execute(
      `async () => {
        await codemode.echo({ text: "hello" });
        await codemode.ping();
        return "done";
      }`,
      providers,
    );
    expect(r.result).toBe("done");
    expect(r.metrics?.toolCalls).toBe(2);
    expect(r.metrics?.toolInputBytes).toBeGreaterThan(0);
    expect(r.metrics?.toolOutputBytes).toBeGreaterThan(0);
  });

  describe("timeout", () => {
    const ORIGINAL = process.env.SMOOV_EXEC_TIMEOUT_MS;

    beforeEach(() => {
      process.env.SMOOV_EXEC_TIMEOUT_MS = "20";
    });

    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.SMOOV_EXEC_TIMEOUT_MS;
      else process.env.SMOOV_EXEC_TIMEOUT_MS = ORIGINAL;
    });

    test("rejects with timeout error when code runs too long", async () => {
      const r = await new LocalExecutor().execute(
        `async () => { await new Promise(r => setTimeout(r, 500)); return "late"; }`,
        trivial,
      );
      expect(r.result).toBeUndefined();
      expect(r.error).toMatch(/executor timeout after 20ms/);
    });
  });
});
