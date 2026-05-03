import { describe, expect, test } from "vite-plus/test";
import {
  isReadOnlyArgv,
  isToolBlockedInMode,
  MODES,
  type Mode,
  modeSystemPrompt,
  nextMode,
} from "../src/mode.ts";

describe("MODES", () => {
  test("has the canonical edit/plan ordering", () => {
    expect(MODES).toEqual(["edit", "plan"]);
  });
});

describe("nextMode", () => {
  test("cycles edit -> plan -> edit", () => {
    expect(nextMode("edit")).toBe("plan");
    expect(nextMode("plan")).toBe("edit");
  });
});

describe("modeSystemPrompt", () => {
  test("returns an empty string for edit mode", () => {
    expect(modeSystemPrompt("edit")).toBe("");
  });

  test("plan-mode prompt forbids write/edit and explains read-only bash", () => {
    const sys = modeSystemPrompt("plan");
    expect(sys).toMatch(/PLAN MODE/);
    expect(sys).toMatch(/write|edit/i);
    expect(sys).toMatch(/read-only/i);
  });
});

describe("isToolBlockedInMode", () => {
  const tools = ["write", "edit", "bash", "codemode", "astGrep", "read"];

  test("never blocks anything in edit mode", () => {
    for (const t of tools) expect(isToolBlockedInMode(t, "edit")).toBe(false);
  });

  test("blocks only `write` and `edit` in plan mode", () => {
    expect(isToolBlockedInMode("write", "plan")).toBe(true);
    expect(isToolBlockedInMode("edit", "plan")).toBe(true);
    expect(isToolBlockedInMode("bash", "plan")).toBe(false);
    expect(isToolBlockedInMode("codemode", "plan")).toBe(false);
  });
});

describe("isReadOnlyArgv", () => {
  test("rejects an empty argv", () => {
    expect(isReadOnlyArgv([])).toBe(false);
  });

  test("accepts every command in the read-only allowlist with simple args", () => {
    const cases: readonly string[][] = [
      ["cat", "file.txt"],
      ["ls", "-la", "src"],
      ["head", "-n", "10", "file.txt"],
      ["tail", "-f", "log.txt"],
      ["wc", "-l", "file.txt"],
      ["stat", "file.txt"],
      ["file", "file.txt"],
      ["pwd"],
      ["echo", "hello"],
      ["grep", "-r", "pattern", "."],
      ["rg", "pattern"],
      ["fd", "name"],
      ["ag", "pattern"],
      ["jq", ".key", "file.json"],
      ["cut", "-d", ",", "-f", "1"],
      ["tr", "a", "b"],
      ["sort", "file.txt"],
      ["uniq", "-c"],
      ["diff", "a", "b"],
      ["cmp", "a", "b"],
      ["env"],
      ["which", "git"],
      ["whoami"],
      ["date"],
      ["uname", "-a"],
    ];
    for (const argv of cases) {
      expect(isReadOnlyArgv(argv)).toBe(true);
    }
  });

  test("rejects unknown / mutating commands", () => {
    const cases: readonly string[][] = [
      ["rm", "x"],
      ["mv", "a", "b"],
      ["cp", "a", "b"],
      ["touch", "x"],
      ["mkdir", "x"],
      ["chmod", "+x", "x"],
      ["npm", "install"],
      ["pnpm", "install"],
      ["curl", "-X", "POST", "https://example.com"],
      ["wget", "https://example.com"],
      ["sed", "-i", "s/a/b/", "file"],
      ["awk", "-i", "inplace", "{}", "file"],
      ["bash", "-c", "rm -rf /"],
      ["sh", "-c", "echo hi"],
      ["node", "script.js"],
    ];
    for (const argv of cases) {
      expect(isReadOnlyArgv(argv)).toBe(false);
    }
  });

  test("accepts read-only git subcommands", () => {
    const cases: readonly string[][] = [
      ["git", "log"],
      ["git", "log", "--oneline", "-n", "20"],
      ["git", "diff"],
      ["git", "diff", "HEAD~1"],
      ["git", "status"],
      ["git", "show", "HEAD"],
      ["git", "blame", "src/file.ts"],
      ["git", "rev-parse", "HEAD"],
      ["git", "ls-files"],
      ["git", "branch"],
      ["git", "branch", "-a"],
      ["git", "tag"],
      ["git", "tag", "-l"],
      ["git", "config", "--get", "user.name"],
      ["git", "remote"],
      ["git", "remote", "-v"],
    ];
    for (const argv of cases) {
      expect(isReadOnlyArgv(argv)).toBe(true);
    }
  });

  test("rejects mutating git subcommands and flags", () => {
    const cases: readonly string[][] = [
      ["git", "push"],
      ["git", "pull"],
      ["git", "fetch"],
      ["git", "commit", "-m", "msg"],
      ["git", "checkout", "branch"],
      ["git", "reset", "--hard"],
      ["git", "rebase", "main"],
      ["git", "merge", "branch"],
      ["git", "branch", "-d", "feature"],
      ["git", "branch", "-D", "feature"],
      ["git", "branch", "-m", "old", "new"],
      ["git", "tag", "-d", "v1"],
      ["git", "tag", "-a", "v1", "-m", "msg"],
      ["git", "config", "--add", "user.name", "alice"],
      ["git", "config", "--unset", "user.name"],
      ["git", "remote", "add", "origin", "url"],
      ["git", "remote", "remove", "origin"],
      ["git", "remote", "set-url", "origin", "url"],
      ["git", "-c", "user.name=alice", "log"],
    ];
    for (const argv of cases) {
      expect(isReadOnlyArgv(argv)).toBe(false);
    }
  });

  test("type Mode covers exactly the two values", () => {
    const all: readonly Mode[] = ["edit", "plan"];
    expect(all).toEqual(MODES);
  });
});
