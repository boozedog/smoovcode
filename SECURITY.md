# SECURITY

The smoovcode agent is designed so the model can read code, write code, and
shell out to real tools — without escaping the project root or leaking
credentials. This document describes the safety envelope that the `@smoovcode/agent`
tools enforce.

## Capability model, not executor-based immutability

Executors run the model-authored codemode program. They do not, by themselves,
make an agent read-only or non-mutating. Side effects come from the
capabilities exposed to that program: a tool that writes files, calls an MCP
server, runs SQL, or invokes a host process can mutate through its host/tool
bridge even if the orchestration code runs in QuickJS.

smoovcode's current policy is:

- codemode receives only staged/sandbox capabilities (`bash`, `astGrep`),
- `write` and `edit` are top-level tool calls and stage changes in the session
  overlay instead of writing host disk,
- sandbox-backed `bash` writes also stage in the same session overlay and are
  visible to later tool calls and turns,
- host-backed `bash` execution is separately gated by the project allowlist and
  per-call user approval.

There are no plan/edit modes. The model can stage; the user decides whether to
apply staged changes in a future explicit workflow. When adding new tools,
classify and gate them by capability. Do not assume that placing a tool behind
an executor makes it non-mutating.

## Two-axis bash execution model

The single `bash` tool dispatches argv to one of two backends:

|              | sandbox (just-bash, OverlayFs) | host (`child_process.spawn`)         |
| ------------ | ------------------------------ | ------------------------------------ |
| Interface    | argv only                      | argv only                            |
| Side effects | none (in-memory writes)        | real (gated by allowlist + approval) |
| Use case     | inspection, read-only ops      | git, package mgr, build, network     |

```
bash(argv) →
  if just-bash supports argv[0]              → sandbox (free)
  else if argv matches host allowlist prefix → host (require user approval)
  else                                       → error
```

The sandbox capability set is built dynamically from
`getCommandNames()` in just-bash (~80 built-ins: cat, ls, grep, rg, sed,
awk, jq, find, etc.). New just-bash releases automatically widen the
sandbox without code changes here.

## Argv only — no shell parsing

The `bash` tool input is `argv: string[]`, **not** a shell script. There
is no parsing of pipes, conditionals, redirects, command substitution,
globs, variable expansion, or backticks anywhere in the path. Composition
(pipelines, branching) happens in the codemode TypeScript layer by
issuing multiple tool calls and routing the data in code.

Path-style arguments are checked for `..` traversal and absolute paths
before they reach the dispatcher. The OverlayFs root containment and the
host spawn's locked cwd are the primary guards; the validator gives the
model a clearer error before it hits them.

## Sandbox guarantees (just-bash + OverlayFs)

- **Root-bounded.** Reads come from the project root via OverlayFs.
  Symlinks that escape the root are rejected.
- **No real-disk writes.** Sandbox writes go to the session overlay;
  nothing persists to disk. The same overlay backs later tool calls and
  later turns in the chat.
- **Gitignore + secret deny filtered reads.** A `GitignoreFs` adapter
  consults patterns from:
  - the project's top-level `.gitignore`,
  - nested `.gitignore` files, with patterns interpreted relative to the
    directory containing that `.gitignore`,
  - `.git/info/exclude`,
  - a built-in default secret deny list (`.env*`, `*.pem`, `id_rsa*`,
    `id_ed25519*`, `*.key`),
  - any `secrets.deny` patterns from `.smoov/config.json`.
    Reads of matched paths fail with ENOENT; matched entries are filtered
    out of `readdir` results.
- **Tightened execution limits.** `maxOutputSize` 1 MB, `maxStringLength`
  5 MB, `maxCommandCount` 1000, `maxLoopIterations` /
  `maxAwkIterations` / `maxSedIterations` / `maxJqIterations` all 1000.
- **30-second wall-clock timeout** per call, propagated via `AbortController`
  to the just-bash interpreter, which stops at the next statement boundary.
- **Network, Python, JavaScript exec** all disabled (just-bash defaults).

## Staged edits (`edit`, `write`)

`edit(path, oldString, newString)` and `write(path, content)` stage changes in
the session-scoped OverlayFs. They do not modify host disk. After a staged
write, subsequent sandbox reads see the new content because all tools in the
chat share the same session filesystem.

These tools do **not** prompt for per-call approval because they are
non-persistent staged mutations. They are still top-level and scrollback-visible
so the operator can inspect what was staged.

Both tools enforce:

- **Root containment.** Paths are validated for absolute-path and `..`
  traversal at the tool boundary; `ReadWriteFs` enforces it again.
- **Symlinks blocked.** Any existing symlink component in the destination path
  causes the write/edit to fail before persistence, so edits cannot be routed
  through a link to another location.
- **Ignore + secret deny refusal.** Writes to paths covered by top-level or
  nested gitignore rules, the default secret deny list, or `secrets.deny` from
  `.smoov/config.json` are refused with a clear error.
- **`edit` uniqueness.** `oldString` must occur exactly once unless
  `replaceAll: true` is passed.

The bash sandbox guarantees still hold: no sandbox-backed command run via
`bash` can modify the real filesystem. Host-backed `bash` calls are real
processes and can mutate according to the approved command's behavior.

## Host execution

When `argv[0]` is not a sandbox built-in, the dispatcher checks the
`host.allow` array in `.smoov/config.json` (and `.smoov/config.local.json`
for user-private overrides). Each entry is an **argv prefix**:

```json
{
  "host": {
    "allow": [
      ["git", "status"],
      ["git", "diff"],
      ["vp", "test"]
    ]
  },
  "secrets": {
    "deny": [".env*", "*.pem", "id_rsa*"]
  }
}
```

`["git", "diff"]` matches `git diff --stat` but not `git push`.

If a match is found, the harness calls the `approveHost` callback with
the full argv. The default approver denies everything; the CLI wires a
real interactive prompt. **Every host call prompts** — there is no
auto-approve, no remember-this-decision. The load-bearing assumption is
that the user reads the prompts; reflexive approval degrades the gate.

After approval the call goes through `child_process.spawn(argv[0],
argv.slice(1), { shell: false, cwd: projectRoot })`:

- **`shell: false`** — argv reaches the OS verbatim, no shell parsing.
- **`cwd: projectRoot`** — fixed to the project root.
- **Output cap** — stdout + stderr capped at 1 MB; the process is killed
  with SIGTERM if it exceeds the cap.
- **Wall-clock timeout** — same 30-second envelope as the sandbox.

A non-allowlisted host argv is rejected before approval is asked.

## Configuration

The agent reads two files at startup:

- `.smoov/config.json` — committed project config; allow list and
  secret-deny list shared by everyone.
- `.smoov/config.local.json` — user-private overrides, gitignored.
  Allow / deny entries are appended to the project file's, never
  replacing them.

Both files are validated with zod at load time. Invalid configs fail
loud with a clear error pointing at the offending field.

## Known limitations

- **Executors are not a side-effect firewall.** QuickJS isolates JavaScript
  glue, not the host-side behavior of exposed tools. Treat newly added tools
  (including MCP tools) as capabilities that may need read/write
  classification, approval, and top-level visibility.
- **Tracked-but-not-denylisted files remain readable.** The model can
  still echo a non-secret tracked file's contents into its response.
  The sandbox stops writes and escape, not arbitrary read-and-quote.
- **Pipelines and redirects are not expressible in a single `bash`
  call.** Compose them in code (`stdin` parameter, multiple calls).
