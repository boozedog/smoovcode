import { CloudflareExecutor, LocalExecutor, QuickJSExecutor } from "@smoovcode/agent";
import { describe, expect, test } from "vite-plus/test";
import { pickExecutor } from "../src/pick-executor.ts";

describe("pickExecutor", () => {
  test("returns LocalExecutor for 'local'", () => {
    const e = pickExecutor("local");
    expect(e).toBeInstanceOf(LocalExecutor);
    expect(e.name).toBe("local");
  });

  test("returns QuickJSExecutor for 'quickjs'", () => {
    const e = pickExecutor("quickjs");
    expect(e).toBeInstanceOf(QuickJSExecutor);
    expect(e.name).toBe("quickjs");
  });

  test("returns CloudflareExecutor for 'cloudflare'", () => {
    const e = pickExecutor("cloudflare");
    expect(e).toBeInstanceOf(CloudflareExecutor);
    expect(e.name).toBe("cloudflare");
  });

  test("throws for an unknown backend", () => {
    expect(() => pickExecutor("nope")).toThrow(/unknown backend: nope/);
  });

  test("throws for an empty string", () => {
    expect(() => pickExecutor("")).toThrow(/unknown backend:/);
  });

  test("returns a fresh instance on each call", () => {
    const a = pickExecutor("local");
    const b = pickExecutor("local");
    expect(a).not.toBe(b);
  });
});
