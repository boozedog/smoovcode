import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { createToolSession } from "../src/tool-session.ts";

async function invoke(tool: unknown, input: unknown): Promise<unknown> {
  const exec = (tool as { execute?: (i: unknown, o: unknown) => unknown }).execute;
  if (!exec) throw new Error("tool has no execute");
  return await exec(input, {});
}

describe("ToolSession", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-session-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("reuses one mounted project filesystem across tool sets", async () => {
    const session = createToolSession({ cwd: sandbox });
    await invoke(session.tools().write, { path: "one.txt", content: "persisted\n" });
    const out = (await invoke(session.tools().bash, { argv: ["cat", "one.txt"] })) as {
      stdout: string;
    };
    expect(out.stdout).toBe("persisted\n");
    expect(existsSync(join(sandbox, "one.txt"))).toBe(true);
  });

  test("dirty flag flips on write, mkdir, and rm", async () => {
    const session = createToolSession({ cwd: sandbox });
    expect(session.dirty.isDirty()).toBe(false);
    await invoke(session.tools().write, { path: "one.txt", content: "x" });
    expect(session.dirty.isDirty()).toBe(true);
    session.dirty.clear();
    await invoke(session.tools().bash, { argv: ["mkdir", "dir"] });
    expect(session.dirty.isDirty()).toBe(true);
    session.dirty.clear();
    await invoke(session.tools().bash, { argv: ["rm", "one.txt"] });
    expect(session.dirty.isDirty()).toBe(true);
  });

  test("reset clears dirty state without reverting real project files", async () => {
    const session = createToolSession({ cwd: sandbox });
    await invoke(session.tools().write, { path: "one.txt", content: "x" });
    expect(session.dirty.isDirty()).toBe(true);
    session.reset();
    expect(session.dirty.isDirty()).toBe(false);
    const out = (await invoke(session.tools().bash, { argv: ["cat", "one.txt"] })) as {
      stdout: string;
    };
    expect(out.stdout).toBe("x");
  });
});
