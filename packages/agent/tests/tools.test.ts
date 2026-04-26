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

describe("tools.astGrep", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-astgrep-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("finds matches in a source string with range info", async () => {
    const { astGrep } = createTools({ cwd: sandbox });
    const out = (await invoke(astGrep, {
      pattern: "console.log($A)",
      language: "JavaScript",
      source: "console.log('hi'); console.warn('x'); console.log('bye');",
    })) as {
      matches: Array<{
        text: string;
        range: { start: { line: number; column: number }; end: { line: number; column: number } };
      }>;
    };
    expect(out.matches.length).toBe(2);
    expect(out.matches[0].text).toBe("console.log('hi')");
    expect(out.matches[1].text).toBe("console.log('bye')");
    expect(out.matches[0].range.start.line).toBe(0);
    expect(out.matches[0].range.start.column).toBe(0);
    expect(out.matches[0].range.end.column).toBeGreaterThan(0);
  });

  test("returns empty matches when pattern does not match", async () => {
    const { astGrep } = createTools({ cwd: sandbox });
    const out = (await invoke(astGrep, {
      pattern: "nonexistent_function($X)",
      language: "JavaScript",
      source: "const x = 1",
    })) as { matches: unknown[] };
    expect(out.matches).toEqual([]);
  });

  test("finds matches across files under cwd paths", async () => {
    writeFileSync(join(sandbox, "a.ts"), "function foo() { return 1 }\n");
    writeFileSync(join(sandbox, "b.ts"), "function bar() { return 2 }\n");
    writeFileSync(join(sandbox, "c.ts"), "const baz = 3\n");
    const { astGrep } = createTools({ cwd: sandbox });
    const out = (await invoke(astGrep, {
      pattern: "function $NAME() { return $X }",
      language: "TypeScript",
      paths: ["."],
    })) as { matches: Array<{ file: string; text: string }> };
    expect(out.matches.length).toBe(2);
    const files = out.matches.map((m) => m.file).sort();
    expect(files[0]).toMatch(/a\.ts$/);
    expect(files[1]).toMatch(/b\.ts$/);
  });

  test("rejects when both source and paths are provided", async () => {
    const { astGrep } = createTools({ cwd: sandbox });
    await expect(
      invoke(astGrep, {
        pattern: "$X",
        language: "JavaScript",
        source: "1",
        paths: ["."],
      }),
    ).rejects.toThrow();
  });

  test("rejects when neither source nor paths are provided", async () => {
    const { astGrep } = createTools({ cwd: sandbox });
    await expect(invoke(astGrep, { pattern: "$X", language: "JavaScript" })).rejects.toThrow();
  });

  test("has a description mentioning ast-grep", () => {
    const { astGrep } = createTools({ cwd: sandbox });
    expect(astGrep.description).toMatch(/ast.?grep|structural/i);
  });
});
