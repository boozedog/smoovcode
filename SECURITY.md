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

## Host-backed capabilities

Host process execution remains separate from sandbox `bash` and is currently exposed through typed read-only capabilities such as `git.*` and `gh.*`:

- fixed argv construction; no shell parsing,
- schema-validated inputs,
- `shell: false`,
- rooted at the real project cwd,
- prompts and pagers disabled where applicable,
- timeout and output caps.

Future host-backed write or external capabilities should add explicit user approval and preserve these constraints.

## Capability boundary

The safety boundary is the capability policy: which tools are exposed, what filesystem they can reach, how host commands are gated, and how visibly effects are reported. Adding a new mutating capability must preserve root containment, ignore/secret filtering, and explicit host approval where real host processes or external systems are involved.

See [docs/philosophy.md](./docs/philosophy.md) and [docs/capabilities.md](./docs/capabilities.md) for the broader tool design model.
