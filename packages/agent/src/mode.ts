/**
 * Operating modes for the agent. Each mode shapes how the harness gates
 * tool calls during a single `run()`:
 *
 * - `edit` (default): mutating tools prompt the user for approval per call.
 * - `plan`: read-only research. `write` and `edit` are blocked outright;
 *   `bash` is restricted to a conservative read-only argv allowlist.
 */
export type Mode = "edit" | "plan";

export const MODES: readonly Mode[] = ["edit", "plan"] as const;

export function nextMode(m: Mode): Mode {
  const i = MODES.indexOf(m);
  return MODES[(i + 1) % MODES.length] ?? "edit";
}

const PLAN_PROMPT = `You are in PLAN MODE. Investigate and produce a plan WITHOUT making any changes.
Do not call write or edit. Bash is restricted to read-only commands (ls, cat, grep,
rg, git log/diff/status/show, etc.). At the end, present a concise plan: bullets,
files to change, approach. The user will review and exit plan mode to execute.`;

export function modeSystemPrompt(m: Mode): string {
  if (m === "plan") return PLAN_PROMPT;
  return "";
}

const PLAN_BLOCKED_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

export function isToolBlockedInMode(name: string, m: Mode): boolean {
  if (m !== "plan") return false;
  return PLAN_BLOCKED_TOOLS.has(name);
}

/**
 * Read-only command allowlist for plan mode. Conservative on purpose: a
 * command must be both in the allowlist and called with non-mutating flags.
 * Anything outside this list — or a flag pattern that turns a read into a
 * write — is rejected.
 */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  // Filesystem reads
  "cat",
  "ls",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "pwd",
  "echo",
  // Search
  "grep",
  "rg",
  "fd",
  "ag",
  // Git read-only
  "git",
  // Inspect
  "jq",
  "cut",
  "tr",
  "sort",
  "uniq",
  "diff",
  "cmp",
  // System
  "env",
  "which",
  "whoami",
  "date",
  "uname",
]);

const GIT_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "log",
  "diff",
  "status",
  "show",
  "blame",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "branch",
  "tag",
  "config",
  "describe",
  "remote",
]);

const GIT_BRANCH_MUTATING_FLAGS: ReadonlySet<string> = new Set([
  "-d",
  "-D",
  "-m",
  "-M",
  "-c",
  "-C",
  "--delete",
  "--move",
  "--copy",
  "--create-reflog",
  "--edit-description",
  "--set-upstream",
  "--set-upstream-to",
  "--unset-upstream",
]);

const GIT_TAG_MUTATING_FLAGS: ReadonlySet<string> = new Set([
  "-d",
  "-a",
  "-s",
  "-u",
  "-f",
  "--delete",
  "--annotate",
  "--sign",
  "--force",
]);

const GIT_CONFIG_MUTATING_FLAGS: ReadonlySet<string> = new Set([
  "--add",
  "--unset",
  "--unset-all",
  "--replace-all",
  "--rename-section",
  "--remove-section",
  "--edit",
  "-e",
]);

const GIT_REMOTE_MUTATING_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "add",
  "remove",
  "rm",
  "rename",
  "set-url",
  "set-head",
  "set-branches",
  "prune",
  "update",
]);

export function isReadOnlyArgv(argv: readonly string[]): boolean {
  if (argv.length === 0) return false;
  const cmd = argv[0];
  if (!READ_ONLY_COMMANDS.has(cmd)) return false;
  if (cmd === "git") return isReadOnlyGit(argv.slice(1));
  return true;
}

function isReadOnlyGit(rest: readonly string[]): boolean {
  // Skip top-level options before the subcommand (e.g. `git -C path log`).
  // Reject options known to mutate (`-c key=val`, `--exec-path=...`, etc.).
  let i = 0;
  while (i < rest.length && rest[i].startsWith("-")) {
    const opt = rest[i];
    if (opt === "-C" || opt === "--git-dir" || opt === "--work-tree") {
      i += 2;
      continue;
    }
    if (opt.startsWith("--git-dir=") || opt.startsWith("--work-tree=")) {
      i += 1;
      continue;
    }
    // -c key=value sets config for this invocation; treat as mutating.
    return false;
  }
  const sub = rest[i];
  if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) return false;
  const subArgs = rest.slice(i + 1);
  if (sub === "branch") return !subArgs.some((a) => GIT_BRANCH_MUTATING_FLAGS.has(a));
  if (sub === "tag") return !subArgs.some((a) => GIT_TAG_MUTATING_FLAGS.has(a));
  if (sub === "config") return !subArgs.some((a) => GIT_CONFIG_MUTATING_FLAGS.has(a));
  if (sub === "remote") {
    if (subArgs.length === 0) return true;
    const first = subArgs.find((a) => !a.startsWith("-"));
    if (first === undefined) return true;
    return !GIT_REMOTE_MUTATING_SUBCOMMANDS.has(first);
  }
  return true;
}
