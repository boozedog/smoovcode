import { describe, expect, test } from "vite-plus/test";
import type { ResolvedProvider } from "../src/executor.ts";
import { QuickJSExecutor } from "../src/executors/quickjs.ts";

const trivial: ResolvedProvider[] = [{ name: "codemode", fns: { ping: async () => "pong" } }];

describe("QuickJSExecutor", () => {
  test("has the name 'quickjs'", () => {
    expect(new QuickJSExecutor().name).toBe("quickjs");
  });

  test("returns the awaited result of the code", async () => {
    const r = await new QuickJSExecutor().execute(`async () => 1 + 1`, trivial);
    expect(r.error).toBeUndefined();
    expect(r.result).toBe(2);
  });

  test("calls a host tool via the codemode bridge", async () => {
    const providers: ResolvedProvider[] = [
      {
        name: "codemode",
        fns: { greet: async (a: unknown) => `hi ${(a as { who: string }).who}` },
      },
    ];
    const r = await new QuickJSExecutor().execute(
      `async () => await codemode.greet({ who: "world" })`,
      providers,
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toBe("hi world");
  });

  test("supports multiple namespaces", async () => {
    const providers: ResolvedProvider[] = [
      { name: "alpha", fns: { x: async () => "A" } },
      { name: "beta", fns: { x: async () => "B" } },
    ];
    const r = await new QuickJSExecutor().execute(
      `async () => ({ a: await alpha.x(), b: await beta.x() })`,
      providers,
    );
    expect(r.result).toEqual({ a: "A", b: "B" });
  });

  test("returns error when sandboxed code throws", async () => {
    const r = await new QuickJSExecutor().execute(
      `async () => { throw new Error("nope"); }`,
      trivial,
    );
    expect(r.result).toBeUndefined();
    expect(r.error).toBeDefined();
    expect(r.error).toMatch(/nope/);
  });

  test("propagates a host tool error back into the sandbox as a thrown Error", async () => {
    const providers: ResolvedProvider[] = [
      {
        name: "codemode",
        fns: {
          fail: async () => {
            throw new Error("host-error");
          },
        },
      },
    ];
    const r = await new QuickJSExecutor().execute(
      `async () => {
        try { await codemode.fail(); return "no-throw"; }
        catch (e) { return "caught:" + e.message; }
      }`,
      providers,
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toBe("caught:host-error");
  });

  test("returns error for syntactically invalid code", async () => {
    const r = await new QuickJSExecutor().execute(`this is not js`, trivial);
    expect(r.result).toBeUndefined();
    expect(r.error).toBeDefined();
  });
});
