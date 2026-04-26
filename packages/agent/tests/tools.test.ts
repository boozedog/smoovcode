import { describe, expect, test } from "vite-plus/test";
import { tools } from "../src/tools.ts";

// AI SDK Tool wraps the original handler in `execute`. Helper to invoke it
// without faking the full ToolCallOptions interface that `execute` expects.
async function invoke(tool: unknown, input: unknown): Promise<unknown> {
  const exec = (tool as { execute?: (i: unknown, o: unknown) => unknown }).execute;
  if (!exec) throw new Error("tool has no execute");
  return await exec(input, {});
}

describe("tools.echo", () => {
  test("echoes the input text back", async () => {
    const out = await invoke(tools.echo, { text: "hello" });
    expect(out).toEqual({ echoed: "hello" });
  });

  test("preserves the empty string", async () => {
    const out = await invoke(tools.echo, { text: "" });
    expect(out).toEqual({ echoed: "" });
  });

  test("has a description", () => {
    expect(tools.echo.description).toMatch(/echo/i);
  });
});

describe("tools.add", () => {
  test("sums two positive numbers", async () => {
    const out = await invoke(tools.add, { a: 2, b: 3 });
    expect(out).toEqual({ sum: 5 });
  });

  test("handles negatives", async () => {
    const out = await invoke(tools.add, { a: -7, b: 4 });
    expect(out).toEqual({ sum: -3 });
  });

  test("handles zero", async () => {
    const out = await invoke(tools.add, { a: 0, b: 0 });
    expect(out).toEqual({ sum: 0 });
  });

  test("handles floats", async () => {
    const out = await invoke(tools.add, { a: 0.1, b: 0.2 });
    expect((out as { sum: number }).sum).toBeCloseTo(0.3);
  });

  test("has a description", () => {
    expect(tools.add.description).toMatch(/add/i);
  });
});
