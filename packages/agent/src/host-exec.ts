import { spawn } from "node:child_process";

export interface HostApprovalRequest {
  /** Argv that the agent wants to run on the host. */
  argv: readonly string[];
  /** Optional human-readable reason supplied by the model. */
  reason?: string;
}

/**
 * Approval callback. Return `true` to allow the host call, `false` to reject.
 * The default implementation rejects everything — host execution requires the
 * harness (e.g. CLI) to wire a real prompt.
 */
export type HostApprover = (req: HostApprovalRequest) => Promise<boolean>;

export interface HostExecOptions {
  /** Project root; used as cwd for the spawned process. */
  cwd: string;
  /** Wall-clock timeout in ms. */
  timeoutMs: number;
  /**
   * Cap on captured stdout+stderr in bytes. Past this point output is
   * truncated and the process is killed with SIGTERM. Defaults to 1 MB to
   * mirror the sandbox cap.
   */
  maxOutputBytes?: number;
  /** Optional abort signal that, when fired, terminates the process. */
  signal?: AbortSignal;
}

export interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Pluggable spawner; useful for tests to avoid touching the real child_process. */
export type HostSpawner = (
  argv: readonly string[],
  opts: HostExecOptions,
) => Promise<HostExecResult>;

const DEFAULT_MAX_OUTPUT = 1_048_576;

/**
 * Run argv via `child_process.spawn` with `shell: false`, locked cwd, output
 * cap, and wall-clock timeout. The host is reached only after the dispatcher
 * has matched an allowlist entry and obtained user approval.
 */
export const defaultHostSpawn: HostSpawner = (argv, opts) =>
  new Promise<HostExecResult>((resolve) => {
    const cap = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const child = spawn(argv[0], argv.slice(1), {
      cwd: opts.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let total = 0;
    let truncated = false;

    const append = (which: "out" | "err", chunk: Buffer): void => {
      if (truncated) return;
      const remaining = cap - total;
      if (remaining <= 0) {
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      const text =
        chunk.length > remaining
          ? chunk.subarray(0, remaining).toString("utf8")
          : chunk.toString("utf8");
      total += text.length;
      if (which === "out") stdout += text;
      else stderr += text;
      if (chunk.length > remaining) {
        truncated = true;
        child.kill("SIGTERM");
      }
    };

    child.stdout?.on("data", (c: Buffer) => append("out", c));
    child.stderr?.on("data", (c: Buffer) => append("err", c));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.timeoutMs);
    timeout.unref?.();

    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    if (opts.signal) {
      if (opts.signal.aborted) child.kill("SIGTERM");
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = (): void => {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onAbort);
    };

    child.on("error", (err) => {
      cleanup();
      resolve({
        stdout,
        stderr:
          stderr + (stderr.endsWith("\n") || stderr === "" ? "" : "\n") + (err as Error).message,
        exitCode: 127,
      });
    });

    child.on("close", (code, signal) => {
      cleanup();
      if (truncated && stderr.indexOf("output cap") === -1) {
        stderr += `\nhost: stdout+stderr exceeded ${cap}-byte cap; process terminated.`;
      }
      if (signal === "SIGTERM" && code === null) {
        resolve({ stdout, stderr, exitCode: 124 });
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
