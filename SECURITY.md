# Security model

Executors run the model-authored codemode program. They do not, by themselves, make an agent non-mutating. Side effects come from the capabilities exposed to the executor and from the policies around those capabilities.

## Tool filesystem

By default smoovcode creates a virtual `MountableFs` for tools:

- `/` is an in-memory base filesystem.
- `/projects/<folder-name>` mounts the resolved project root through `ReadWriteFs`.
- sandbox `bash` starts in `/projects/<folder-name>`.

Writes under the project mount update the real working tree immediately. Top-level `write` and `edit` use the same mounted, root-bounded project filesystem.

## Filesystem protections

- Tool paths are constrained to the resolved project root.
- Absolute paths and `..` traversal are rejected at tool boundaries where applicable.
- `ReadWriteFs` enforces root containment again at the filesystem layer.
- Symlink writes are blocked by `write` and `edit`.
- Gitignore patterns, `.git/info/exclude`, the built-in secret deny list, and `.smoov` secret deny configuration hide protected files and reject protected writes.

## Host-backed commands

Host process execution remains separate from sandbox `bash` and is gated:

- argv-only command dispatch; no shell parsing,
- allowlist prefix matching from `.smoov/config.json` / `.smoov/config.local.json`,
- per-call user approval,
- `shell: false`,
- rooted at the real project cwd,
- timeout and output caps.

## Capability boundary

The safety boundary is the capability policy: which tools are exposed, what filesystem they can reach, how host commands are gated, and how visibly effects are reported. Adding a new mutating capability must preserve root containment, ignore/secret filtering, and explicit host approval where real host processes are involved.
