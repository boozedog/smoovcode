import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { defaultHostSpawn } from "../src/host-exec.ts";

describe("defaultHostSpawn", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "smoov-host-spawn-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("captures stdout and exit code from a real process", async () => {
    const out = await defaultHostSpawn(["node", "-e", "console.log('hi')"], {
      cwd: sandbox,
      timeoutMs: 5_000,
    });
    expect(out.stdout).toBe("hi\n");
    expect(out.exitCode).toBe(0);
  });

  test("captures stderr and non-zero exit code", async () => {
    const out = await defaultHostSpawn(["node", "-e", "console.error('boom'); process.exit(2)"], {
      cwd: sandbox,
      timeoutMs: 5_000,
    });
    expect(out.stderr).toContain("boom");
    expect(out.exitCode).toBe(2);
  });

  test("kills the process when the wall-clock timeout fires", async () => {
    const start = Date.now();
    const out = await defaultHostSpawn(["node", "-e", "setTimeout(() => process.exit(0), 5000)"], {
      cwd: sandbox,
      timeoutMs: 100,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2_000);
    expect(out.exitCode).toBe(124);
  });

  test("truncates output that exceeds the byte cap", async () => {
    const script = "process.stdout.write('a'.repeat(20000))";
    const out = await defaultHostSpawn(["node", "-e", script], {
      cwd: sandbox,
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(out.stdout.length).toBeLessThanOrEqual(1024);
    expect(out.stderr).toMatch(/cap|exceeded/i);
  });

  test("returns exitCode 127 when the binary cannot be found", async () => {
    const out = await defaultHostSpawn(["this-binary-definitely-does-not-exist"], {
      cwd: sandbox,
      timeoutMs: 5_000,
    });
    expect(out.exitCode).toBe(127);
  });
});
