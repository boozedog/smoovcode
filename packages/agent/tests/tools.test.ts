import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { createTools } from "../src/tools.ts";

// AI SDK Tool wraps the original handler in `execute`. Helper to invoke it
// without faking the full ToolCallOptions interface that `execute` expects.
async function invoke(tool: unknown, input: unknown): Promise<unknown> {
  const exec = (tool as { execute?: (i: unknown, o: unknown) => unknown }).execute;
  if (!exec) throw new Error("tool has no execute");
  return await exec(input, {});
}

describe("tools.echo", () => {
  test("echoes the input text back", async () => {
    const { echo } = createTools();
    const out = await invoke(echo, { text: "hello" });
    expect(out).toEqual({ echoed: "hello" });
  });

  test("preserves the empty string", async () => {
    const { echo } = createTools();
    const out = await invoke(echo, { text: "" });
    expect(out).toEqual({ echoed: "" });
  });

  test("has a description", () => {
    const { echo } = createTools();
    expect(echo.description).toMatch(/echo/i);
  });
});

describe("tools.add", () => {
  test("sums two positive numbers", async () => {
    const { add } = createTools();
    const out = await invoke(add, { a: 2, b: 3 });
    expect(out).toEqual({ sum: 5 });
  });

  test("handles negatives", async () => {
    const { add } = createTools();
    const out = await invoke(add, { a: -7, b: 4 });
    expect(out).toEqual({ sum: -3 });
  });

  test("handles zero", async () => {
    const { add } = createTools();
    const out = await invoke(add, { a: 0, b: 0 });
    expect(out).toEqual({ sum: 0 });
  });

  test("handles floats", async () => {
    const { add } = createTools();
    const out = await invoke(add, { a: 0.1, b: 0.2 });
    expect((out as { sum: number }).sum).toBeCloseTo(0.3);
  });

  test("has a description", () => {
    const { add } = createTools();
    expect(add.description).toMatch(/add/i);
  });
});

describe("tools.bash", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-bash-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("runs a simple command and returns stdout/exitCode", async () => {
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { script: "echo hello" })) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    expect(out.stdout).toBe("hello\n");
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
  });

  test("propagates non-zero exit codes", async () => {
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { script: "false" })) as { exitCode: number };
    expect(out.exitCode).toBe(1);
  });

  test("can read files from the cwd via the overlay", async () => {
    writeFileSync(join(sandbox, "greet.txt"), "hi from disk\n");
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { script: "cat greet.txt" })) as { stdout: string };
    expect(out.stdout).toBe("hi from disk\n");
  });

  test("writes do not persist to the real filesystem", async () => {
    const { bash } = createTools({ cwd: sandbox });
    await invoke(bash, { script: "echo overlay-only > new.txt" });
    const fs = await import("node:fs");
    expect(fs.existsSync(join(sandbox, "new.txt"))).toBe(false);
  });

  test("shares filesystem state across exec calls within one tools instance", async () => {
    const { bash } = createTools({ cwd: sandbox });
    await invoke(bash, { script: "echo persisted > scratch.txt" });
    const out = (await invoke(bash, { script: "cat scratch.txt" })) as { stdout: string };
    expect(out.stdout).toBe("persisted\n");
  });

  test("isolates state across separate tools instances", async () => {
    const a = createTools({ cwd: sandbox });
    await invoke(a.bash, { script: "echo only-in-a > scratch.txt" });
    const b = createTools({ cwd: sandbox });
    const out = (await invoke(b.bash, {
      script: "test -f scratch.txt && echo yes || echo no",
    })) as { stdout: string };
    expect(out.stdout).toBe("no\n");
  });

  test("accepts stdin", async () => {
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { script: "cat", stdin: "piped\n" })) as {
      stdout: string;
    };
    expect(out.stdout).toBe("piped\n");
  });

  test("has a description", () => {
    const { bash } = createTools({ cwd: sandbox });
    expect(bash.description).toMatch(/bash|shell/i);
  });
});
