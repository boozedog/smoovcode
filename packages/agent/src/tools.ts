import { isAbsolute, normalize, resolve as resolvePath, sep } from "node:path";
import { findInFiles, Lang, parse, type SgNode } from "@ast-grep/napi";
import { tool } from "ai";
import { Bash, type BashOptions, getCommandNames, OverlayFs, ReadWriteFs } from "just-bash";
import { z } from "zod";
import { loadSmoovConfig, matchesAllowPrefix, type SmoovConfig } from "./config.ts";
import { GitignoreFs, loadIgnorePatterns } from "./gitignore-fs.ts";
import {
  defaultHostSpawn,
  type HostApprover,
  type HostExecResult,
  type HostSpawner,
} from "./host-exec.ts";

const LANG_NAMES = ["JavaScript", "TypeScript", "Tsx", "Html", "Css"] as const;
type LangName = (typeof LANG_NAMES)[number];

interface AstGrepMatch {
  file: string;
  text: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

function formatMatch(file: string, node: SgNode): AstGrepMatch {
  const range = node.range();
  return {
    file,
    text: node.text(),
    range: {
      start: { line: range.start.line, column: range.start.column },
      end: { line: range.end.line, column: range.end.column },
    },
  };
}

export interface CreateToolsOptions {
  /** Root directory exposed to the bash tool via OverlayFs. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Extra ignore patterns layered on top of the project's .gitignore and the
   * built-in secret deny list. Typically supplied from .smoov/config.json.
   */
  extraDenyPatterns?: readonly string[];
  /**
   * Wall-clock timeout (in ms) for a single bash invocation. Defaults to 30s.
   * The signal is propagated to the just-bash interpreter so cooperatively
   * cancellable commands stop at the next statement boundary.
   */
  execTimeoutMs?: number;
  /**
   * Pre-loaded smoov config. When omitted, `loadSmoovConfig({ root: cwd })` is
   * called so secrets.deny and host.allow take effect automatically. Mostly an
   * injection point for tests.
   */
  config?: SmoovConfig;
  /**
   * Approval callback for host execution. Called once per host argv, before
   * spawn. Returning `false` causes the call to be reported back to the model
   * as a denied execution. Defaults to deny-all.
   */
  approveHost?: HostApprover;
  /**
   * Override the host spawner. Defaults to `defaultHostSpawn` (real
   * `child_process.spawn`); useful in tests to avoid touching the host.
   */
  hostSpawn?: HostSpawner;
}

/**
 * Execution limits for the sandboxed bash environment. Tightened versus the
 * just-bash defaults so a runaway agent burns at most ~1MB of output and
 * ~1k commands/loops before the interpreter trips.
 */
export const SANDBOX_LIMITS: NonNullable<BashOptions["executionLimits"]> = {
  maxOutputSize: 1_048_576,
  maxStringLength: 5_242_880,
  maxCommandCount: 1_000,
  maxLoopIterations: 1_000,
  maxAwkIterations: 1_000,
  maxSedIterations: 1_000,
  maxJqIterations: 1_000,
};

export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

/**
 * Set of command names handled by the in-process sandbox (just-bash). Built
 * dynamically from just-bash's registry so the capability set stays in sync
 * with the underlying library rather than a hardcoded list.
 */
export const SANDBOX_COMMAND_NAMES: ReadonlySet<string> = new Set(getCommandNames());

const COMMAND_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Validate the *shape* of an argv: non-empty, plain command name, no path
 * arguments that escape the project root. This runs before the dispatcher
 * decides between sandbox and host paths so both branches share the same
 * rejection rules.
 *
 * Path traversal protection is defense in depth — the OverlayFs root
 * containment and the host spawn's locked cwd are the primary guards;
 * this gives the model a clearer error before it reaches them.
 */
export function validateArgvShape(argv: readonly string[]): void {
  if (argv.length === 0) {
    throw new Error("bash: argv must be a non-empty array of strings.");
  }
  const cmd = argv[0];
  if (typeof cmd !== "string" || !COMMAND_NAME_RE.test(cmd)) {
    throw new Error(
      `bash: invalid command name: ${JSON.stringify(cmd)}. Command names must match ${COMMAND_NAME_RE}.`,
    );
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== "string") {
      throw new Error(`bash: argv[${i}] must be a string`);
    }
    const looksLikePath =
      a.startsWith("/") || a.startsWith("./") || a.startsWith("../") || a.includes("/");
    if (!looksLikePath) continue;
    if (isAbsolute(a)) {
      throw new Error(`bash: absolute path argument is not allowed (would escape root): ${a}`);
    }
    const norm = normalize(a);
    if (norm === ".." || norm.startsWith(`..${sep}`) || norm.startsWith("../")) {
      throw new Error(`bash: path argument escapes the project root via traversal: ${a}`);
    }
  }
}

export function createTools(opts: CreateToolsOptions = {}) {
  const root = opts.cwd ?? process.cwd();
  const overlay = new OverlayFs({ root });
  const rwfs = new ReadWriteFs({ root });
  const mountPoint = overlay.getMountPoint();
  const config: SmoovConfig = opts.config ?? loadSmoovConfig({ root });
  const ignorePatterns = loadIgnorePatterns({
    root,
    extra: [...config.secrets.deny, ...(opts.extraDenyPatterns ?? [])],
  });
  const filteredOverlay = new GitignoreFs({
    inner: overlay,
    mountPoint,
    patterns: ignorePatterns,
  });
  const ignoreMatcher = new GitignoreFs({ inner: rwfs, patterns: ignorePatterns });
  const execTimeoutMs = opts.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const approveHost: HostApprover = opts.approveHost ?? (async () => false);
  const hostSpawn: HostSpawner = opts.hostSpawn ?? defaultHostSpawn;
  const allowList = config.host.allow;
  const bashEnv = new Bash({
    fs: filteredOverlay,
    cwd: mountPoint,
    executionLimits: SANDBOX_LIMITS,
  });

  // Reject absolute paths and any `..` traversal that escapes the root.
  function assertInsideRoot(relPath: string): void {
    if (isAbsolute(relPath)) {
      throw new Error(`path must be relative to the project root: ${relPath}`);
    }
    const normalized = normalize(relPath);
    if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
      throw new Error(`path escapes the project root: ${relPath}`);
    }
  }

  function assertNotIgnored(relPath: string): void {
    if (ignoreMatcher.isIgnored(relPath)) {
      throw new Error(`path is on the ignore/secret-deny list and cannot be modified: ${relPath}`);
    }
  }

  // Atomic write to disk (temp file + rename), then mirror into the bash
  // overlay so subsequent sandbox reads see the new content.
  async function persistFile(relPath: string, content: string): Promise<void> {
    assertInsideRoot(relPath);
    assertNotIgnored(relPath);
    const tmpPath = `${relPath}.smoov.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await rwfs.writeFile(tmpPath, content);
    try {
      await rwfs.mv(tmpPath, relPath);
    } catch (err) {
      await rwfs.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }
    const virtualPath = mountPoint.endsWith("/")
      ? `${mountPoint}${relPath}`
      : `${mountPoint}/${relPath}`;
    overlay.writeFileSync(virtualPath, content);
  }

  return {
    bash: tool({
      description:
        "Run a single sandboxed command via argv (no shell parsing). argv[0] must be a sandbox built-in (cat, ls, grep, rg, sed, awk, jq, find, etc.). Reads come from the project directory; writes stay in memory and never touch disk. Compose pipelines/conditionals in code by calling this tool multiple times.",
      inputSchema: z.object({
        argv: z
          .array(z.string())
          .min(1)
          .describe(
            "Command name followed by arguments. No shell parsing — args are passed verbatim like child_process.spawn.",
          ),
        stdin: z.string().optional().describe("Standard input to pass to the command."),
      }),
      execute: async ({ argv, stdin }) => {
        validateArgvShape(argv);
        const cmd = argv[0];

        if (!SANDBOX_COMMAND_NAMES.has(cmd)) {
          if (!matchesAllowPrefix(argv, allowList)) {
            throw new Error(
              `bash: '${cmd}' is not in the sandbox capability set or the .smoov/config.json host allowlist.`,
            );
          }
          const approved = await approveHost({ argv });
          if (!approved) {
            return {
              stdout: "",
              stderr: `bash: host execution of ${argv.join(" ")} was denied by the user.`,
              exitCode: 1,
            };
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), execTimeoutMs);
          try {
            const result: HostExecResult = await hostSpawn(argv, {
              cwd: root,
              timeoutMs: execTimeoutMs,
              signal: controller.signal,
            });
            return result;
          } finally {
            clearTimeout(timer);
          }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), execTimeoutMs);
        try {
          const result = await bashEnv.exec(cmd, {
            args: argv.slice(1),
            ...(stdin !== undefined ? { stdin } : {}),
            signal: controller.signal,
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          };
        } catch (err) {
          if (controller.signal.aborted) {
            return {
              stdout: "",
              stderr: `bash: aborted after ${execTimeoutMs}ms wall-clock timeout`,
              exitCode: 124,
            };
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      },
    }),

    write: tool({
      description:
        "Create or overwrite a file at `path` (relative to the project root) with `content`. Atomic on disk (temp file + rename); root-bounded; symlinks blocked. The bash sandbox sees the new content on subsequent calls.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Path relative to the project root."),
        content: z.string().describe("Full file content to write."),
      }),
      execute: async ({ path, content }) => {
        await persistFile(path, content);
        return { path, bytes: Buffer.byteLength(content, "utf8") };
      },
    }),

    edit: tool({
      description:
        "Replace `oldString` with `newString` in the file at `path` (relative to the project root). By default `oldString` must occur exactly once; pass `replaceAll: true` to substitute every occurrence. Atomic on disk; root-bounded; symlinks blocked.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Path relative to the project root."),
        oldString: z.string().describe("Exact substring to find."),
        newString: z.string().describe("Replacement string."),
        replaceAll: z
          .boolean()
          .optional()
          .describe("Replace every occurrence instead of requiring uniqueness."),
      }),
      execute: async ({ path, oldString, newString, replaceAll }) => {
        assertInsideRoot(path);
        if (oldString === newString) {
          throw new Error("edit: oldString and newString are identical; nothing to do.");
        }
        if (!(await rwfs.exists(path))) {
          throw new Error(`edit: file not found: ${path}`);
        }
        const stat = await rwfs.stat(path);
        if (!stat.isFile) {
          throw new Error(`edit: not a regular file: ${path}`);
        }
        const original = await rwfs.readFile(path);
        const firstIdx = original.indexOf(oldString);
        if (firstIdx === -1) {
          throw new Error(`edit: oldString not found in ${path}`);
        }

        let updated: string;
        let replacements: number;
        if (replaceAll) {
          updated = original.split(oldString).join(newString);
          replacements = 0;
          let i = 0;
          while ((i = original.indexOf(oldString, i)) !== -1) {
            replacements++;
            i += oldString.length;
          }
        } else {
          const nextIdx = original.indexOf(oldString, firstIdx + oldString.length);
          if (nextIdx !== -1) {
            throw new Error(
              `edit: oldString occurs more than once in ${path}; pass replaceAll=true or expand oldString to be unique.`,
            );
          }
          updated =
            original.slice(0, firstIdx) + newString + original.slice(firstIdx + oldString.length);
          replacements = 1;
        }

        await persistFile(path, updated);
        return { path, replacements };
      },
    }),

    astGrep: tool({
      description:
        "Structural code search using ast-grep AST patterns (e.g. 'console.log($A)'). Provide either `source` to search a string, or `paths` to recursively search files under cwd. Returns `{ matches: Array<{ file, text, range }> }` — read `result.matches`, not `result.length`.",
      inputSchema: z.object({
        pattern: z.string().describe("ast-grep pattern, e.g. 'console.log($ARG)'."),
        language: z.enum(LANG_NAMES).describe("Source language for parsing."),
        source: z
          .string()
          .optional()
          .describe("Source string to search. Mutually exclusive with `paths`."),
        paths: z
          .array(z.string())
          .optional()
          .describe(
            "Paths (relative to cwd) to search recursively. Mutually exclusive with `source`.",
          ),
      }),
      execute: async ({ pattern, language, source, paths }) => {
        const haveSource = source !== undefined;
        const havePaths = paths !== undefined;
        if (haveSource === havePaths) {
          throw new Error("astGrep: provide exactly one of `source` or `paths`.");
        }

        const lang = Lang[language as LangName];

        if (haveSource) {
          const root = parse(lang, source!).root();
          const matches = root.findAll(pattern).map((n) => formatMatch("<source>", n));
          return { matches };
        }

        const resolvedPaths = paths!.map((p) => resolvePath(root, p));
        const collected: AstGrepMatch[] = [];
        await findInFiles(
          lang,
          { paths: resolvedPaths, matcher: { rule: { pattern } } },
          (err, nodes) => {
            if (err) throw err;
            for (const n of nodes) {
              collected.push(formatMatch(n.getRoot().filename(), n));
            }
          },
        );
        return { matches: collected };
      },
    }),
  };
}
