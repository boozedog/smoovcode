import {
  CloudflareExecutor,
  type Executor,
  LocalExecutor,
  QuickJSExecutor,
} from "@smoovcode/agent";

export function pickExecutor(name: string): Executor {
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
