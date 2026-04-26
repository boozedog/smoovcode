import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { findProjectRoot } from "../src/find-project-root.ts";

describe("findProjectRoot", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-find-root-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("returns the directory itself when it contains .smoov", () => {
    mkdirSync(join(sandbox, ".smoov"));
    expect(findProjectRoot(sandbox)).toBe(sandbox);
  });

  test("returns the directory itself when it contains .git", () => {
    mkdirSync(join(sandbox, ".git"));
    expect(findProjectRoot(sandbox)).toBe(sandbox);
  });

  test("walks up to find an ancestor with .smoov", () => {
    mkdirSync(join(sandbox, ".smoov"));
    const nested = join(sandbox, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(sandbox);
  });

  test("walks up to find an ancestor with .git", () => {
    mkdirSync(join(sandbox, ".git"));
    const nested = join(sandbox, "x", "y");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(sandbox);
  });

  test("prefers the closest ancestor when multiple markers exist", () => {
    mkdirSync(join(sandbox, ".git"));
    const inner = join(sandbox, "inner");
    mkdirSync(inner);
    mkdirSync(join(inner, ".smoov"));
    const nested = join(inner, "deep");
    mkdirSync(nested);
    expect(findProjectRoot(nested)).toBe(inner);
  });

  test("returns the start dir when no marker is found up to the filesystem root", () => {
    const nested = join(sandbox, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(nested);
  });
});
