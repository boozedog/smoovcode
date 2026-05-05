import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OverlayFs, ReadWriteFs } from "just-bash";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { GitignoreFs, loadIgnorePatterns } from "../src/gitignore-fs.ts";

describe("GitignoreFs (over ReadWriteFs)", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-ignorefs-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("readFile of an ignored path throws ENOENT", async () => {
    writeFileSync(join(sandbox, "secret.env"), "TOKEN=xyz");
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: ["*.env"] });
    await expect(fs.readFile("secret.env")).rejects.toThrow(/ENOENT|not found/i);
  });

  test("readFile of a non-ignored path passes through", async () => {
    writeFileSync(join(sandbox, "ok.txt"), "hello");
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: ["*.env"] });
    expect(await fs.readFile("ok.txt")).toBe("hello");
  });

  test("exists returns false for ignored paths even when present on disk", async () => {
    writeFileSync(join(sandbox, ".env"), "x");
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: [".env"] });
    expect(await fs.exists(".env")).toBe(false);
  });

  test("stat of an ignored path throws ENOENT", async () => {
    writeFileSync(join(sandbox, "id_rsa"), "key");
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: ["id_rsa*"] });
    await expect(fs.stat("id_rsa")).rejects.toThrow(/ENOENT|not found/i);
  });

  test("readdir filters out ignored entries", async () => {
    writeFileSync(join(sandbox, "keep.txt"), "");
    writeFileSync(join(sandbox, ".env"), "");
    writeFileSync(join(sandbox, "key.pem"), "");
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: [".env", "*.pem"] });
    const entries = await fs.readdir(".");
    expect(entries.sort()).toEqual(["keep.txt"]);
  });

  test("readdirWithFileTypes filters out ignored entries", async () => {
    writeFileSync(join(sandbox, "keep.txt"), "");
    writeFileSync(join(sandbox, ".env"), "");
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: [".env"] });
    const entries = await fs.readdirWithFileTypes!(".");
    expect(entries.map((e) => e.name).sort()).toEqual(["keep.txt"]);
  });

  test("ignores files inside an ignored directory", async () => {
    mkdirSync(join(sandbox, "node_modules"));
    writeFileSync(join(sandbox, "node_modules", "pkg.txt"), "");
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: ["node_modules"] });
    await expect(fs.readFile("node_modules/pkg.txt")).rejects.toThrow(/ENOENT|not found/i);
    expect(await fs.exists("node_modules/pkg.txt")).toBe(false);
  });

  test("write operations pass through", async () => {
    const inner = new ReadWriteFs({ root: sandbox });
    const fs = new GitignoreFs({ inner, patterns: ["*.tmp"] });
    await fs.writeFile("hello.txt", "hi");
    expect(await fs.readFile("hello.txt")).toBe("hi");
  });
});

describe("GitignoreFs (over OverlayFs with mount point)", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-ignorefs-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("filters reads when paths are virtual (under mount point)", async () => {
    writeFileSync(join(sandbox, ".env"), "TOKEN=1");
    writeFileSync(join(sandbox, "ok.txt"), "ok");
    const inner = new OverlayFs({ root: sandbox });
    const mp = inner.getMountPoint();
    const fs = new GitignoreFs({ inner, mountPoint: mp, patterns: [".env"] });
    await expect(fs.readFile(`${mp}/.env`)).rejects.toThrow(/ENOENT|not found/i);
    expect(await fs.readFile(`${mp}/ok.txt`)).toBe("ok");
  });

  test("filters readdir on the virtual mount point", async () => {
    writeFileSync(join(sandbox, ".env"), "");
    writeFileSync(join(sandbox, "keep.txt"), "");
    const inner = new OverlayFs({ root: sandbox });
    const mp = inner.getMountPoint();
    const fs = new GitignoreFs({ inner, mountPoint: mp, patterns: [".env"] });
    const entries = await fs.readdir(mp);
    expect(entries.sort()).toEqual(["keep.txt"]);
  });
});

describe("loadIgnorePatterns", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-load-ignore-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("returns the built-in default deny list when no .gitignore exists", () => {
    const patterns = loadIgnorePatterns({ root: sandbox });
    expect(patterns).toContain(".env");
    expect(patterns).toContain("*.pem");
    expect(patterns.some((p) => p.startsWith("id_rsa"))).toBe(true);
  });

  test("merges patterns from project .gitignore", () => {
    writeFileSync(join(sandbox, ".gitignore"), "dist\nnode_modules\n");
    const patterns = loadIgnorePatterns({ root: sandbox });
    expect(patterns).toContain("dist");
    expect(patterns).toContain("node_modules");
  });

  test("merges nested .gitignore patterns relative to their directory", () => {
    mkdirSync(join(sandbox, "src", "generated"), { recursive: true });
    writeFileSync(join(sandbox, "src", ".gitignore"), "generated\n*.local\n!important.local\n");
    const patterns = loadIgnorePatterns({ root: sandbox });
    expect(patterns).toContain("src/generated");
    expect(patterns).toContain("src/*.local");
    expect(patterns).toContain("!src/important.local");
  });

  test("merges patterns from .git/info/exclude", () => {
    mkdirSync(join(sandbox, ".git", "info"), { recursive: true });
    writeFileSync(join(sandbox, ".git", "info", "exclude"), "scratch.txt\n");
    const patterns = loadIgnorePatterns({ root: sandbox });
    expect(patterns).toContain("scratch.txt");
  });

  test("appends extra deny patterns supplied by the caller", () => {
    const patterns = loadIgnorePatterns({ root: sandbox, extra: ["my-secret-*"] });
    expect(patterns).toContain("my-secret-*");
  });

  test("strips comments and blank lines", () => {
    writeFileSync(join(sandbox, ".gitignore"), "# a comment\n\nfoo\n# trailing\n");
    const patterns = loadIgnorePatterns({ root: sandbox });
    expect(patterns).toContain("foo");
    expect(patterns.some((p) => p.startsWith("#"))).toBe(false);
  });
});
