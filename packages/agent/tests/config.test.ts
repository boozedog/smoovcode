import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { loadSmoovConfig } from "../src/config.ts";

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
    expect(cfg.secrets.deny).toEqual([]);
  });

  test("loads secrets.deny from .smoov/config.json", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({ secrets: { deny: ["*.pem"] } }),
    );
    const cfg = loadSmoovConfig({ root: sandbox });
    expect(cfg.secrets.deny).toEqual(["*.pem"]);
  });

  test("merges entries from .smoov/config.local.json", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({ secrets: { deny: [".env"] } }),
    );
    writeFileSync(
      join(sandbox, ".smoov", "config.local.json"),
      JSON.stringify({ secrets: { deny: ["my-private.txt"] } }),
    );
    const cfg = loadSmoovConfig({ root: sandbox });
    expect(cfg.secrets.deny).toEqual([".env", "my-private.txt"]);
  });

  test("throws a clear error for an unknown top-level key", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(join(sandbox, ".smoov", "config.json"), JSON.stringify({ unknownKey: 1 }));
    expect(() => loadSmoovConfig({ root: sandbox })).toThrow(/config|invalid|unknown/i);
  });

  test("throws when host.allow is present because host passthrough is unsupported", () => {
    mkdirSync(join(sandbox, ".smoov"));
    writeFileSync(
      join(sandbox, ".smoov", "config.json"),
      JSON.stringify({ host: { allow: [["git", "status"]] } }),
    );
    expect(() => loadSmoovConfig({ root: sandbox })).toThrow(/host|unknown|invalid/i);
  });
});
