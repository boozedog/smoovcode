import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  createDefaultCapabilityRegistry,
  validateGitPath,
  type HostProcessRunner,
} from "../src/capabilities.ts";

function runner(
  calls: Array<{ command: string; args: string[]; cwd: string }>,
  stdout = "{}",
): HostProcessRunner {
  return async (command, args, opts) => {
    calls.push({ command, args: [...args], cwd: opts.cwd });
    return { stdout, stderr: "", exitCode: 0 };
  };
}

describe("host capabilities", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "smoov-cap-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("builds fixed gh issue view argv and parses JSON", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const registry = createDefaultCapabilityRegistry({
      cwd,
      runner: runner(calls, '{"number":27,"title":"T"}'),
    });

    const out = await registry.execute("gh.issue.view", { number: 27 });

    expect(out).toEqual({ number: 27, title: "T" });
    expect(calls[0]).toEqual({
      command: "gh",
      args: [
        "issue",
        "view",
        "27",
        "--json",
        "number,title,body,state,labels,assignees,author,url",
      ],
      cwd,
    });
  });

  test("builds gh issue list argv from validated options", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const registry = createDefaultCapabilityRegistry({ cwd, runner: runner(calls, "[]") });

    await registry.execute("gh.issue.list", {
      state: "open",
      labels: ["bug", "help wanted"],
      limit: 50,
    });

    expect(calls[0].args).toEqual([
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      "bug",
      "--label",
      "help wanted",
      "--limit",
      "50",
      "--json",
      "number,title,state,labels,assignees,author,url",
    ]);
  });

  test("builds fixed git diff argv with -- before paths", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const registry = createDefaultCapabilityRegistry({ cwd, runner: runner(calls, "diff") });

    const out = await registry.execute("git.diff", { paths: ["src/index.ts"] });

    expect(out).toEqual({ stdout: "diff", stderr: "", exitCode: 0 });
    expect(calls[0]).toEqual({ command: "git", args: ["diff", "--", "src/index.ts"], cwd });
  });

  test("rejects injection-like git paths before spawning", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const registry = createDefaultCapabilityRegistry({ cwd, runner: runner(calls, "") });

    await expect(registry.execute("git.diff", { paths: ["../secret"] })).rejects.toThrow(
      /path|traversal|escape/i,
    );
    await expect(registry.execute("git.diff", { paths: ["--output=/tmp/pwned"] })).rejects.toThrow(
      /path|option/i,
    );
    expect(calls).toEqual([]);
  });

  test("validates git paths without shell escaping", () => {
    expect(validateGitPath("src/a file; rm -rf .ts")).toBe("src/a file; rm -rf .ts");
    expect(() => validateGitPath("/tmp/x")).toThrow(/relative/);
    expect(() => validateGitPath("a/../../x")).toThrow(/escape|traversal/);
  });

  test("exposes enabled capabilities as codemode tool providers with callable sanitized names", () => {
    const registry = createDefaultCapabilityRegistry({ cwd, runner: runner([]) });
    const providers = registry.toToolProviders();

    expect(providers.map((p) => p.name).sort()).toEqual(["gh", "git"]);
    expect(Object.keys(providers.find((p) => p.name === "gh")?.tools ?? {}).sort()).toContain(
      "issue_list",
    );
    expect(Object.keys(providers.find((p) => p.name === "git")?.tools ?? {}).sort()).toContain(
      "status",
    );
  });

  test("emits inner call start and result events", async () => {
    const events: unknown[] = [];
    const registry = createDefaultCapabilityRegistry({
      cwd,
      runner: runner([], '{"number":28}'),
      observer: {
        onInnerToolCallStart: (call) => {
          events.push({ type: "start", call });
        },
        onInnerToolCallEnd: (call, output) => {
          events.push({ type: "end", call, output });
        },
      },
    });

    await registry.execute("gh.issue.view", { number: 28 }, { parentTool: "codemode" });

    expect(events).toMatchObject([
      { type: "start", call: { parentTool: "codemode", capability: "gh.issue.view" } },
      { type: "end", call: { parentTool: "codemode" }, output: { number: 28 } },
    ]);
  });

  test("emits inner call error events", async () => {
    const events: unknown[] = [];
    const registry = createDefaultCapabilityRegistry({
      cwd,
      runner: async () => {
        throw new Error("boom");
      },
      observer: {
        onInnerToolCallError: (call, error) => {
          events.push({ call, error });
        },
      },
    });

    await expect(registry.execute("gh.issue.view", { number: 1 })).rejects.toThrow("boom");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ call: { capability: "gh.issue.view" }, error: "boom" });
  });

  test("policy denial prevents execution", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const registry = createDefaultCapabilityRegistry({
      cwd,
      runner: runner(calls),
      policy: { beforeToolCall: async () => ({ type: "deny", reason: "not allowed" }) },
    });

    await expect(registry.execute("gh.issue.view", { number: 1 })).rejects.toThrow("not allowed");
    expect(calls).toEqual([]);
  });

  test("declares source and sink flow metadata and can deny github sink flows", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const registry = createDefaultCapabilityRegistry({
      cwd,
      runner: runner(calls),
      policy: {
        checkFlow: async ({ sinks }) =>
          sinks.includes("github")
            ? { type: "deny", reason: "github writes require approval" }
            : { type: "allow" },
      },
    });

    await registry.execute("gh.issue.view", { number: 1 });
    await expect(registry.execute("gh.issue.comment", { number: 1, body: "hi" })).rejects.toThrow(
      /approval/,
    );
    expect(registry.get("gh.issue.view")?.flow).toEqual({ sources: ["github"] });
    expect(registry.get("gh.issue.comment")?.flow).toEqual({ sinks: ["github"] });
  });
});
