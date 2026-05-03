import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  test("runs a sandbox command via argv and returns stdout/exitCode", async () => {
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { argv: ["echo", "hello"] })) as {
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
    const out = (await invoke(bash, { argv: ["false"] })) as { exitCode: number };
    expect(out.exitCode).toBe(1);
  });

  test("can read files from the cwd via the overlay", async () => {
    writeFileSync(join(sandbox, "greet.txt"), "hi from disk\n");
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { argv: ["cat", "greet.txt"] })) as { stdout: string };
    expect(out.stdout).toBe("hi from disk\n");
  });

  test("preserves whitespace in arguments (no shell parsing)", async () => {
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { argv: ["echo", "two words"] })) as { stdout: string };
    expect(out.stdout).toBe("two words\n");
  });

  test("rejects an empty argv", async () => {
    const { bash } = createTools({ cwd: sandbox });
    await expect(invoke(bash, { argv: [] })).rejects.toThrow();
  });

  test("rejects commands that aren't in the sandbox capability set", async () => {
    const { bash } = createTools({ cwd: sandbox });
    await expect(invoke(bash, { argv: ["git", "status"] })).rejects.toThrow(
      /not in (the )?sandbox|allowlist/i,
    );
  });

  test("rejects shell metacharacters in the command name", async () => {
    const { bash } = createTools({ cwd: sandbox });
    await expect(invoke(bash, { argv: ["echo;rm", "x"] })).rejects.toThrow();
  });

  test("rejects path arguments that try to escape the project root", async () => {
    const { bash } = createTools({ cwd: sandbox });
    await expect(invoke(bash, { argv: ["cat", "../escape.txt"] })).rejects.toThrow(
      /escape|traversal/i,
    );
  });

  test("accepts stdin", async () => {
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { argv: ["cat"], stdin: "piped\n" })) as {
      stdout: string;
    };
    expect(out.stdout).toBe("piped\n");
  });

  test("has a description", () => {
    const { bash } = createTools({ cwd: sandbox });
    expect(bash.description).toMatch(/bash|shell|sandbox|argv/i);
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

  test("skips files hidden by gitignore and secret deny filters", async () => {
    writeFileSync(join(sandbox, ".gitignore"), "ignored.ts\n");
    writeFileSync(join(sandbox, "ignored.ts"), "function hidden() { return 1 }\n");
    writeFileSync(join(sandbox, "visible.ts"), "function shown() { return 2 }\n");
    const { astGrep } = createTools({ cwd: sandbox });
    const out = (await invoke(astGrep, {
      pattern: "function $NAME() { return $X }",
      language: "TypeScript",
      paths: ["."],
    })) as { matches: Array<{ file: string; text: string }> };
    expect(out.matches.map((m) => m.text)).toEqual(["function shown() { return 2 }"]);
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

  test("description documents the { matches } return shape", () => {
    const { astGrep } = createTools({ cwd: sandbox });
    expect(astGrep.description).toMatch(/\{\s*matches/);
  });
});

describe("tools.write", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-write-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("creates a new file on real disk", async () => {
    const { write } = createTools({ cwd: sandbox });
    await invoke(write, { path: "hello.txt", content: "hi\n" });
    expect(readFileSync(join(sandbox, "hello.txt"), "utf8")).toBe("hi\n");
  });

  test("overwrites an existing file", async () => {
    writeFileSync(join(sandbox, "x.txt"), "old");
    const { write } = createTools({ cwd: sandbox });
    await invoke(write, { path: "x.txt", content: "new" });
    expect(readFileSync(join(sandbox, "x.txt"), "utf8")).toBe("new");
  });

  test("creates parent directories as needed", async () => {
    const { write } = createTools({ cwd: sandbox });
    await invoke(write, { path: "a/b/c.txt", content: "deep" });
    expect(readFileSync(join(sandbox, "a/b/c.txt"), "utf8")).toBe("deep");
  });

  test("syncs the bash overlay so a subsequent cat sees the new content", async () => {
    const { write, bash } = createTools({ cwd: sandbox });
    await invoke(write, { path: "synced.txt", content: "fresh\n" });
    const out = (await invoke(bash, { argv: ["cat", "synced.txt"] })) as { stdout: string };
    expect(out.stdout).toBe("fresh\n");
  });

  test("rejects path traversal outside the project root", async () => {
    const { write } = createTools({ cwd: sandbox });
    await expect(invoke(write, { path: "../escape.txt", content: "no" })).rejects.toThrow();
  });

  test("rejects an empty path", async () => {
    const { write } = createTools({ cwd: sandbox });
    await expect(invoke(write, { path: "", content: "x" })).rejects.toThrow();
  });

  test("rejects writes through symlinks", async () => {
    const outside = mkdtempSync(join(tmpdir(), "smoov-write-outside-"));
    try {
      writeFileSync(join(outside, "target.txt"), "secret");
      symlinkSync(join(outside, "target.txt"), join(sandbox, "link.txt"));
      const { write } = createTools({ cwd: sandbox });
      await expect(invoke(write, { path: "link.txt", content: "nope" })).rejects.toThrow(
        /symlink|outside|root|escape|not allowed/i,
      );
      expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("secret");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("tools.edit", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-edit-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("replaces a unique occurrence and persists to disk", async () => {
    writeFileSync(join(sandbox, "f.txt"), "alpha beta gamma\n");
    const { edit } = createTools({ cwd: sandbox });
    const out = (await invoke(edit, {
      path: "f.txt",
      oldString: "beta",
      newString: "BETA",
    })) as { replacements: number };
    expect(out.replacements).toBe(1);
    expect(readFileSync(join(sandbox, "f.txt"), "utf8")).toBe("alpha BETA gamma\n");
  });

  test("rejects when oldString occurs more than once and replaceAll is false", async () => {
    writeFileSync(join(sandbox, "dup.txt"), "x x x");
    const { edit } = createTools({ cwd: sandbox });
    await expect(invoke(edit, { path: "dup.txt", oldString: "x", newString: "y" })).rejects.toThrow(
      /more than once|unique/i,
    );
  });

  test("replaceAll substitutes every occurrence", async () => {
    writeFileSync(join(sandbox, "dup.txt"), "x x x");
    const { edit } = createTools({ cwd: sandbox });
    const out = (await invoke(edit, {
      path: "dup.txt",
      oldString: "x",
      newString: "y",
      replaceAll: true,
    })) as { replacements: number };
    expect(out.replacements).toBe(3);
    expect(readFileSync(join(sandbox, "dup.txt"), "utf8")).toBe("y y y");
  });

  test("rejects when the file does not exist", async () => {
    const { edit } = createTools({ cwd: sandbox });
    await expect(
      invoke(edit, { path: "missing.txt", oldString: "a", newString: "b" }),
    ).rejects.toThrow();
  });

  test("rejects when oldString is not present", async () => {
    writeFileSync(join(sandbox, "f.txt"), "hello");
    const { edit } = createTools({ cwd: sandbox });
    await expect(
      invoke(edit, { path: "f.txt", oldString: "absent", newString: "x" }),
    ).rejects.toThrow();
  });

  test("rejects when oldString equals newString", async () => {
    writeFileSync(join(sandbox, "f.txt"), "hello");
    const { edit } = createTools({ cwd: sandbox });
    await expect(
      invoke(edit, { path: "f.txt", oldString: "hello", newString: "hello" }),
    ).rejects.toThrow();
  });

  test("rejects path traversal outside the project root", async () => {
    const { edit } = createTools({ cwd: sandbox });
    await expect(
      invoke(edit, { path: "../escape.txt", oldString: "a", newString: "b" }),
    ).rejects.toThrow();
  });

  test("syncs the overlay so a subsequent bash cat reflects the edit", async () => {
    writeFileSync(join(sandbox, "f.txt"), "before\n");
    const { edit, bash } = createTools({ cwd: sandbox });
    await invoke(edit, { path: "f.txt", oldString: "before", newString: "after" });
    const out = (await invoke(bash, { argv: ["cat", "f.txt"] })) as { stdout: string };
    expect(out.stdout).toBe("after\n");
  });

  test("rejects edits through symlinks", async () => {
    const outside = mkdtempSync(join(tmpdir(), "smoov-edit-outside-"));
    try {
      writeFileSync(join(outside, "target.txt"), "old");
      symlinkSync(join(outside, "target.txt"), join(sandbox, "link.txt"));
      const { edit } = createTools({ cwd: sandbox });
      await expect(
        invoke(edit, { path: "link.txt", oldString: "old", newString: "new" }),
      ).rejects.toThrow(/symlink|outside|root|escape|not allowed|regular file/i);
      expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("old");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("tools.bash host dispatch", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-host-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("routes allowlisted argv to the host spawner after approval", async () => {
    const { bash } = createTools({
      cwd: sandbox,
      config: { host: { allow: [["git", "status"]] }, secrets: { deny: [] } },
      approveHost: async () => true,
      hostSpawn: async (argv, _opts) => ({
        stdout: `ran: ${argv.join(" ")}\n`,
        stderr: "",
        exitCode: 0,
      }),
    });
    const out = (await invoke(bash, { argv: ["git", "status", "--short"] })) as {
      stdout: string;
      exitCode: number;
    };
    expect(out.stdout).toBe("ran: git status --short\n");
    expect(out.exitCode).toBe(0);
  });

  test("rejects argv that is neither in the sandbox nor the host allowlist", async () => {
    const { bash } = createTools({
      cwd: sandbox,
      config: { host: { allow: [["git", "status"]] }, secrets: { deny: [] } },
    });
    await expect(invoke(bash, { argv: ["git", "push"] })).rejects.toThrow(
      /not in (the )?sandbox|allowlist/i,
    );
  });

  test("does not spawn when approval is denied", async () => {
    let spawned = false;
    const { bash } = createTools({
      cwd: sandbox,
      config: { host: { allow: [["git", "status"]] }, secrets: { deny: [] } },
      approveHost: async () => false,
      hostSpawn: async () => {
        spawned = true;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const out = (await invoke(bash, { argv: ["git", "status"] })) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    expect(spawned).toBe(false);
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toMatch(/denied/i);
  });

  test("forwards the project root as cwd to the host spawner", async () => {
    let observedCwd: string | undefined;
    const { bash } = createTools({
      cwd: sandbox,
      config: { host: { allow: [["git", "status"]] }, secrets: { deny: [] } },
      approveHost: async () => true,
      hostSpawn: async (_argv, opts) => {
        observedCwd = opts.cwd;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    await invoke(bash, { argv: ["git", "status"] });
    expect(observedCwd).toBe(sandbox);
  });

  test("really spawns a host process for an allowlisted command (node --version)", async () => {
    const { bash } = createTools({
      cwd: sandbox,
      config: { host: { allow: [["node", "--version"]] }, secrets: { deny: [] } },
      approveHost: async () => true,
    });
    const out = (await invoke(bash, { argv: ["node", "--version"] })) as {
      stdout: string;
      exitCode: number;
    };
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toMatch(/^v\d+\.\d+\.\d+/);
  });

  test("path-traversal arguments are rejected before approval is asked", async () => {
    let approvalCalled = false;
    const { bash } = createTools({
      cwd: sandbox,
      config: { host: { allow: [["git", "diff"]] }, secrets: { deny: [] } },
      approveHost: async () => {
        approvalCalled = true;
        return true;
      },
    });
    await expect(invoke(bash, { argv: ["git", "diff", "../escape.txt"] })).rejects.toThrow(
      /escape|traversal/i,
    );
    expect(approvalCalled).toBe(false);
  });
});

describe("tools.bash limits + timeout", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-limits-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("trips maxAwkIterations at the 1000 cap (tightened from 10k)", async () => {
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, {
      argv: ["awk", "BEGIN{i=0; while(i<5000){i++}; print i}"],
    })) as { stdout: string; stderr: string; exitCode: number };
    expect(out.exitCode).not.toBe(0);
    expect(out.stdout).not.toBe("5000\n");
  });

  test("aborts a long-running command at the configured wall-clock timeout", async () => {
    const { bash } = createTools({ cwd: sandbox, execTimeoutMs: 100 });
    const start = Date.now();
    await invoke(bash, { argv: ["sleep", "5"] });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2_000);
  });

  test("does not abort fast commands under the timeout", async () => {
    const { bash } = createTools({ cwd: sandbox, execTimeoutMs: 5_000 });
    const out = (await invoke(bash, { argv: ["echo", "done"] })) as {
      stdout: string;
      exitCode: number;
    };
    expect(out.stdout).toBe("done\n");
    expect(out.exitCode).toBe(0);
  });
});

describe("tools secret/ignore filtering", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-secret-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("bash sandbox cannot read default-denied secret files (.env)", async () => {
    writeFileSync(join(sandbox, ".env"), "API_KEY=super-secret\n");
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { argv: ["cat", ".env"] })) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    expect(out.stdout).not.toContain("super-secret");
    expect(out.exitCode).not.toBe(0);
  });

  test("bash sandbox does not list default-denied files in ls", async () => {
    writeFileSync(join(sandbox, "id_rsa"), "PRIVATE\n");
    writeFileSync(join(sandbox, "key.pem"), "PRIVATE\n");
    writeFileSync(join(sandbox, "keep.txt"), "ok\n");
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { argv: ["ls", "-1"] })) as { stdout: string };
    expect(out.stdout).toContain("keep.txt");
    expect(out.stdout).not.toContain("id_rsa");
    expect(out.stdout).not.toContain("key.pem");
  });

  test("bash sandbox skips paths covered by project .gitignore", async () => {
    writeFileSync(join(sandbox, ".gitignore"), "blocked.txt\n");
    writeFileSync(join(sandbox, "blocked.txt"), "nope\n");
    writeFileSync(join(sandbox, "visible.txt"), "yes\n");
    const { bash } = createTools({ cwd: sandbox });
    const cat = (await invoke(bash, { argv: ["cat", "blocked.txt"] })) as {
      stdout: string;
      exitCode: number;
    };
    expect(cat.stdout).not.toContain("nope");
    expect(cat.exitCode).not.toBe(0);
    const ok = (await invoke(bash, { argv: ["cat", "visible.txt"] })) as { stdout: string };
    expect(ok.stdout).toBe("yes\n");
  });

  test("write tool refuses to write to a secret-deny path", async () => {
    const { write } = createTools({ cwd: sandbox });
    await expect(invoke(write, { path: ".env", content: "TOKEN=1" })).rejects.toThrow(
      /ignored|denied|secret/i,
    );
  });

  test("secrets.deny patterns from .smoov/config.json hide files from the sandbox", async () => {
    writeFileSync(join(sandbox, "config-secret.txt"), "hush\n");
    const fs = await import("node:fs");
    fs.mkdirSync(join(sandbox, ".smoov"));
    fs.writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({ secrets: { deny: ["config-secret.txt"] } }),
    );
    const { bash } = createTools({ cwd: sandbox });
    const out = (await invoke(bash, { argv: ["cat", "config-secret.txt"] })) as {
      stdout: string;
      exitCode: number;
    };
    expect(out.stdout).not.toContain("hush");
    expect(out.exitCode).not.toBe(0);
  });

  test("edit tool refuses to edit a gitignored path", async () => {
    writeFileSync(join(sandbox, ".gitignore"), "blocked.txt\n");
    writeFileSync(join(sandbox, "blocked.txt"), "old\n");
    const { edit } = createTools({ cwd: sandbox });
    await expect(
      invoke(edit, { path: "blocked.txt", oldString: "old", newString: "new" }),
    ).rejects.toThrow(/ignored|denied|secret|not found/i);
  });
});
