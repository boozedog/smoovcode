import type { ExecuteResult, Executor, ToolFns } from "../executor.ts";

// Stub. DynamicWorkerExecutor needs a `worker_loaders` binding, which only
// exists when this process is itself a Cloudflare Worker. Two paths to make
// this real:
//   1. Run the harness inside `wrangler dev` and import DynamicWorkerExecutor
//      directly with env.LOADER passed in.
//   2. Deploy a thin Worker that exposes execute() over HTTP and call it from
//      the local CLI. Pays a network round-trip per turn.
export class CloudflareExecutor implements Executor {
  readonly name = "cloudflare";

  async execute(_code: string, _providers: ToolFns): Promise<ExecuteResult> {
    return {
      result: undefined,
      error: "CloudflareExecutor not implemented yet — see src/executors/cloudflare.ts",
    };
  }
}
