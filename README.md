# smoovcode

An AI-powered coding assistant with sandboxed code execution. smoovcode provides both a CLI and a rich TUI interface for interactive AI-driven development, featuring structural code search, file operations, and secure code execution in isolated environments.

## Overview

smoovcode is a monorepo containing:

- **`@smoovcode/agent`** — Core agent library that streams AI responses and manages tool execution
- **`@smoovcode/ui-core`** — State management for conversations, approval queues, and text processing
- **`@smoovcode/ui-react`** — React hooks for agent sessions and approval handling
- **`smoov-cli`** — Simple terminal-based CLI interface
- **`smoov-tui`** — Rich terminal UI built with React and Ink

## Features

### AI Integration

- Streams responses from OpenAI-compatible APIs
- Supports both Chat and Responses API modes with auto-detection
- Zero Data Retention (ZDR) provider support
- Configurable models and custom base URLs

### Sandboxed Execution

Multiple executor backends for running AI-generated codemode orchestration code:

| Executor     | Description                                      |
| ------------ | ------------------------------------------------ |
| `quickjs`    | **Default** — QuickJS WASM sandbox for JS glue   |
| `local`      | Direct Node.js execution with timeout protection |
| `cloudflare` | Cloudflare Workers runtime (planned)             |

Executors are not mutation boundaries. They control where the model-authored codemode program runs; side effects come from the tools/capabilities exposed to that program. smoovcode mounts the real project read/write at `/projects/<folder-name>` in a virtual tool filesystem, so sandbox command writes and top-level `write`/`edit` calls update the working tree immediately.

### Agent Tools

The AI agent has access to a deliberately small capability surface:

- **`codemode`** — Run model-authored TypeScript orchestration code with read-style tools
- **`sh.*` sandboxed command tools** — Execute reviewed read-style commands from the in-process `just-bash` builtin registry; no shell parsing and no arbitrary host binaries
- **`astGrep`** — Structural code search using AST patterns (JavaScript, TypeScript, TSX, HTML, CSS)
- **typed `git.*` / `gh.*` capabilities** — Read-only host wrappers for repository and GitHub context
- **`write`** — Create or overwrite project files as visible top-level mutations
- **`edit`** — Apply precise text replacements as visible top-level mutations

### Security Features

- **Mounted project filesystem** — The project is mounted read/write at `/projects/<folder-name>` with root containment
- **Typed host capabilities** — Git and GitHub access goes through fixed-argv wrappers with disabled prompts, timeouts, and output caps
- **Gitignore-aware** — Respects top-level and nested project ignore patterns
- **Secret filtering** — Built-in deny lists for sensitive files
- **Sandbox timeouts** — Tight execution limits and wall-clock timeouts

## Quick Start

### Prerequisites

- Node.js >= 22.12.0
- npm 11.13.0

### Configuration

Set these environment variables (in `.env` or your shell):

```bash
# Required: API key for AI provider
SMOOV_API_KEY=your-api-key-here

# Optional: Custom base URL (defaults to OpenAI)
SMOOV_BASE_URL=https://api.openai.com/v1

# Optional: Model selection
SMOOV_MODEL=gpt-4o

# Optional: Execution backend (quickjs, local)
SMOOV_BACKEND=quickjs

# Optional: Force API mode (chat, responses)
SMOOV_API_MODE=chat

# Optional: Mark provider as ZDR (zero data retention)
SMOOV_ZDR=true
```

### Run the CLI

```bash
# Development mode
npm run cli

# Or directly
npm run dev -w smoov-cli
```

### Run the TUI

```bash
# Development mode
npm run tui

# Or directly
npm run dev -w smoov-tui
```

## Monorepo Commands

This project uses [Vite+](https://vitejs.dev) for the unified toolchain:

```bash
# Check everything (types, lint, tests, build)
npm run ready

# Run all tests
vp run -r test

# Build all packages
vp run -r build

# Run type checking
vp check
```

## Package Reference

### @smoovcode/agent

Core agent functionality:

```typescript
import { Agent, QuickJSExecutor, createTools } from "@smoovcode/agent";

const agent = new Agent({
  executor: new QuickJSExecutor(),
  model: "gpt-4o",
  system: "You are a helpful coding assistant",
  cwd: "/path/to/project",
});

for await (const event of agent.run("Refactor this code")) {
  console.log(event);
}
```

### @smoovcode/ui-core

Conversation state management:

```typescript
import { reduceConversation, ApprovalQueue, coalesceTextDeltas } from "@smoovcode/ui-core";
```

### @smoovcode/ui-react

React hooks for agent integration:

```typescript
import { useAgentSession, useApprovalQueue } from "@smoovcode/ui-react";
```

## Architecture

The codebase is organized into clear separation of concerns:

1. **Agent Layer** (`packages/agent`) — AI SDK integration, tool definitions, executors
2. **UI Core** (`packages/ui-core`) — Pure state logic, no React dependencies
3. **UI React** (`packages/ui-react`) — React bindings for UI Core
4. **Applications** (`apps/*`) — CLI and TUI implementations

### Tool Execution Flow

1. AI generates tool calls during streaming response.
2. Top-level tools execute in the host agent process (`codemode`, `write`, `edit`).
3. `codemode` runs model-authored TypeScript in the configured executor.
4. The tools exposed to codemode (`sh.*`, `astGrep`, `git.*`, `gh.*`) bridge back to host-side implementations.
5. Sandbox commands, `write`, and `edit` operate through a `MountableFs` with the real project mounted read/write at `/projects/<folder-name>`.
6. Typed host capabilities such as `git.*` and `gh.*` invoke fixed argv commands with validation, timeouts, and output caps.
7. Results stream back to the AI for continuation.

The safety boundary is the capability policy: which tools are exposed where, how they are gated, and how visibly their effects are reported. A mutating capability exposed to codemode could mutate even when the codemode program itself runs in QuickJS.

## Documentation

- [Philosophy](./docs/philosophy.md) — why smoovcode favors typed capabilities over raw shell access
- [Architecture](./docs/architecture.md) — package layout, execution flow, filesystem model, and executors
- [Capabilities](./docs/capabilities.md) — current model-facing tools and host wrappers
- [Capability roadmap](./docs/capability-roadmap.md) — how to add project, Git, and GitHub workflows safely

## Safety

The agent's sandboxing, typed host capabilities, and edit/write semantics are documented in [SECURITY.md](./SECURITY.md).

## Development

This is a Vite+ monorepo using npm workspaces. See [AGENTS.md](./AGENTS.md) for agent-facing toolchain guidance.

## License

MIT (see individual package `package.json` files)
