import { describe, expect, test } from "vite-plus/test";
import { normalizeProviders, type ResolvedProvider, type ToolFns } from "../src/executor.ts";

describe("normalizeProviders", () => {
  test("returns array unchanged when given ResolvedProvider[]", () => {
    const input: ResolvedProvider[] = [
      { name: "codemode", fns: { echo: async () => "hi" } },
      { name: "other", fns: { ping: async () => "pong" } },
    ];
    const result = normalizeProviders(input);
    expect(result).toBe(input);
  });

  test("wraps a flat ToolFns record under the codemode namespace", () => {
    const fns: ToolFns = {
      echo: async () => ({ echoed: "x" }),
      add: async () => ({ sum: 0 }),
    };
    const result = normalizeProviders(fns);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("codemode");
    expect(result[0]?.fns).toBe(fns);
  });

  test("preserves positionalArgs flag on resolved providers", () => {
    const input: ResolvedProvider[] = [
      { name: "p", fns: { f: async () => null }, positionalArgs: true },
    ];
    expect(normalizeProviders(input)[0]?.positionalArgs).toBe(true);
  });

  test("handles an empty ToolFns record", () => {
    const result = normalizeProviders({});
    expect(result).toEqual([{ name: "codemode", fns: {} }]);
  });

  test("handles an empty ResolvedProvider[]", () => {
    expect(normalizeProviders([])).toEqual([]);
  });
});
