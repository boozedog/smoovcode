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
import { TuiApp } from "./app.ts";

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
    session: agent.session,
    run: (msg: string, opts?: { signal?: AbortSignal } & AgentRunOptions) => agent.run(msg, opts),
  };

  const app = new TuiApp({
    agent: agentLike,
    approvalQueue,
    banner,
    stats: { cwd: projectRoot, model: model ?? "gpt-5" },
  });

  process.once("SIGINT", () => {
    app.stop();
    process.exit(130);
  });
  app.start();
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
