#!/usr/bin/env node
import {
  Agent,
  type AgentRunOptions,
  CloudflareExecutor,
  type Executor,
  findProjectRoot,
  type HostApprovalRequest,
  type HostApprover,
  LocalExecutor,
  QuickJSExecutor,
} from "@smoovcode/agent";
import { ApprovalQueue } from "@smoovcode/ui-core";
import { render } from "ink";
import React from "react";
import { App } from "./app.tsx";

function pickExecutor(name: string): Executor {
  switch (name) {
    case "local":
      return new LocalExecutor();
    case "quickjs":
      return new QuickJSExecutor();
    case "cloudflare":
      return new CloudflareExecutor();
    default:
      throw new Error(`unknown backend: ${name}`);
  }
}

async function main() {
  const projectRoot = findProjectRoot(process.cwd());
  const backend = process.env.SMOOV_BACKEND ?? "quickjs";
  const model = process.env.SMOOV_MODEL;
  const executor = pickExecutor(backend);

  const approvalQueue = new ApprovalQueue<HostApprovalRequest>();
  const approveHost: HostApprover = (req) => approvalQueue.enqueue(req);

  const agent = new Agent({ executor, model, cwd: projectRoot, approveHost });

  const banner = `smoovcode (backend: ${executor.name}, root: ${projectRoot}) — ctrl-c to exit`;

  const agentLike = {
    run: (msg: string, opts?: { signal?: AbortSignal } & AgentRunOptions) => {
      const runOpts: AgentRunOptions | undefined =
        opts?.mode !== undefined ? { mode: opts.mode } : undefined;
      return agent.run(msg, runOpts);
    },
  };

  const renderOptions =
    process.env.SMOOV_KITTY_KEYBOARD === "1"
      ? {
          // Opt-in: some terminals echo kitty negotiation/reset sequences like
          // `^[[?0u` into the scrollback. Shift+Enter may behave like Enter
          // when this is disabled, but Shift+Tab mode cycling still works in
          // common terminals.
          kittyKeyboard: { mode: "auto" as const },
        }
      : {};

  const instance = render(React.createElement(App, { agent: agentLike, approvalQueue, banner }), {
    exitOnCtrlC: true,
    ...renderOptions,
  });

  const onSigint = () => {
    instance.unmount();
    process.exit(130);
  };
  process.once("SIGINT", onSigint);
  void instance.waitUntilExit().finally(() => process.off("SIGINT", onSigint));
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
