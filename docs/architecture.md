# Architecture

smoovcode is a monorepo with four main layers.

## Packages

- `packages/agent` — AI provider integration, system prompt, executors, tool definitions, capability registry, filesystem policy.
- `packages/ui-core` — framework-independent conversation state, approval queue, and text delta utilities.
- `packages/ui-react` — React hooks that bind UI state to agent sessions.
- `packages/utils` — shared utility package.

## Applications

- `apps/cli` — simple terminal CLI.
- `apps/tui` — richer terminal UI.

## Tool execution flow

1. The user sends a message to an `Agent`.
2. The agent streams a model response through the AI SDK.
3. The model may call top-level tools: `codemode`, `write`, or `edit`.
4. `codemode` runs model-authored TypeScript in the selected executor.
5. The executor receives only the capabilities explicitly supplied to it.
6. File mutations through `write` and `edit` update the real working tree through the mounted project filesystem.
7. Tool calls and results stream back to the UI as conversation events.

## Filesystem model

Tools see a virtual filesystem:

- `/` is an in-memory base filesystem.
- `/projects/<folder-name>` is the real project root mounted read/write.
- sandboxed command execution starts in the mounted project directory.

Root containment, ignore rules, secret deny patterns, and symlink checks protect file operations.

## Executor model

Executors run codemode programs. The current executors are:

- `quickjs` — default QuickJS WASM sandbox.
- `local` — local Node.js execution with timeout protection.
- `cloudflare` — planned Cloudflare Workers backend.

Executors are intentionally separate from capability policy. A restrictive executor with powerful tools can still mutate; a permissive executor with read-only tools may be harmless.
