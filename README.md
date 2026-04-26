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

Multiple executor backends for running AI-generated code:

| Executor     | Description                                           |
| ------------ | ----------------------------------------------------- |
| `quickjs`    | **Default** — QuickJS WASM sandbox (isolated, secure) |
| `local`      | Direct Node.js execution with timeout protection      |
| `cloudflare` | Cloudflare Workers runtime (planned)                  |

### Agent Tools

The AI agent has access to these powerful tools:

- **`bash`** — Execute shell commands with configurable timeouts and host approval
- **`astGrep`** — Structural code search using AST patterns (JavaScript, TypeScript, TSX, HTML, CSS)
- **`write`** — Create new files atomically
- **`edit`** — Modify existing files with precise text replacement

### Security Features

- **Host execution approval** — Interactive prompts before running shell commands
- **Gitignore-aware** — Respects project ignore patterns
- **Secret filtering** — Built-in deny lists for sensitive files
- **Sandbox timeouts** — Configurable execution limits
- **Read-only overlay** — Filesystem isolation for read operations

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

1. AI generates tool calls during streaming response
2. Tools execute (`bash`, `astGrep`, `write`, `edit`)
3. Read tools (`bash`, `astGrep`) run inside codemode for orchestration
4. Write tools (`write`, `edit`) are top-level for visibility and approval
5. Results streamed back to AI for continuation

## Safety

The agent's sandboxing, host-allowlist, and edit/write semantics are documented in [SECURITY.md](./SECURITY.md).

## Development

This is a Vite+ monorepo using npm workspaces. See [CLAUDE.md](./CLAUDE.md) for detailed toolchain documentation.

## License

MIT (see individual package `package.json` files)
