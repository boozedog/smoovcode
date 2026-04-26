import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { loadSmoovConfig, matchesAllowPrefix } from "../src/config.ts";

describe("loadSmoovConfig", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-config-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("returns an empty config when no .smoov directory exists", () => {
    const cfg = loadSmoovConfig({ root: sandbox });
    expect(cfg.host.allow).toEqual([]);
    expect(cfg.secrets.deny).toEqual([]);
  });

  test("loads host.allow and secrets.deny from .smoov/config.json", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({
        host: {
          allow: [
            ["git", "status"],
            ["vp", "test"],
          ],
        },
        secrets: { deny: ["*.pem"] },
      }),
    );
    const cfg = loadSmoovConfig({ root: sandbox });
    expect(cfg.host.allow).toEqual([
      ["git", "status"],
      ["vp", "test"],
    ]);
    expect(cfg.secrets.deny).toEqual(["*.pem"]);
  });

  test("merges entries from .smoov/config.local.json", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({
        host: { allow: [["git", "status"]] },
        secrets: { deny: [".env"] },
      }),
    );
    writeFileSync(
      join(sandbox, ".smoov", "config.local.json"),
      JSON.stringify({
        host: { allow: [["gh", "pr", "create"]] },
        secrets: { deny: ["my-private.txt"] },
      }),
    );
    const cfg = loadSmoovConfig({ root: sandbox });
    expect(cfg.host.allow).toEqual([
      ["git", "status"],
      ["gh", "pr", "create"],
    ]);
    expect(cfg.secrets.deny).toEqual([".env", "my-private.txt"]);
  });

  test("throws a clear error for an unknown top-level key", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(join(sandbox, ".smoov", "config.json"), JSON.stringify({ unknownKey: 1 }));
    expect(() => loadSmoovConfig({ root: sandbox })).toThrow(/config|invalid|unknown/i);
  });

  test("throws when host.allow contains a non-string element", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({ host: { allow: [["git", 1]] } }),
    );
    expect(() => loadSmoovConfig({ root: sandbox })).toThrow();
  });

  test("throws when host.allow contains an empty argv prefix", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({ host: { allow: [[]] } }),
    );
    expect(() => loadSmoovConfig({ root: sandbox })).toThrow();
  });
});

describe("matchesAllowPrefix", () => {
  test("matches when argv starts with the prefix", () => {
    expect(matchesAllowPrefix(["git", "diff", "--stat"], [["git", "diff"]])).toBe(true);
  });

  test("matches exactly the prefix length", () => {
    expect(matchesAllowPrefix(["git", "status"], [["git", "status"]])).toBe(true);
  });

  test("does not match a different second token", () => {
    expect(matchesAllowPrefix(["git", "push"], [["git", "diff"]])).toBe(false);
  });

  test("does not match when argv is shorter than the prefix", () => {
    expect(matchesAllowPrefix(["git"], [["git", "diff"]])).toBe(false);
  });

  test("matches across multiple prefix candidates", () => {
    const prefixes = [
      ["git", "status"],
      ["vp", "test"],
    ];
    expect(matchesAllowPrefix(["vp", "test", "--watch"], prefixes)).toBe(true);
  });

  test("returns false for empty prefix list", () => {
    expect(matchesAllowPrefix(["git", "status"], [])).toBe(false);
  });
});
