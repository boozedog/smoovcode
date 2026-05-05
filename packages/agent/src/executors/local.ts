import {
  createEmptyMetrics,
  type ExecuteNestedToolCall,
  type ExecuteResult,
  type Executor,
  normalizeProviders,
  type Providers,
  wrapProvidersWithMetrics,
} from "../executor.ts";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export class LocalExecutor implements Executor {
  readonly name = "local";

  async execute(code: string, providers: Providers): Promise<ExecuteResult> {
    const logs: string[] = [];
    const sandboxConsole = {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    };

    const metrics = createEmptyMetrics();
    const nestedToolCalls: ExecuteNestedToolCall[] = [];
    const resolved = wrapProvidersWithMetrics(
      normalizeProviders(providers),
      metrics,
      nestedToolCalls,
    );
    const namespaceNames = resolved.map((p) => p.name);
    const namespaceObjs = resolved.map((p) => p.fns);

    try {
      const fn = new AsyncFunction(...namespaceNames, "console", `return await (${code})()`);
      const timeoutMs = Number(process.env.SMOOV_EXEC_TIMEOUT_MS ?? 30000);
      const result = await Promise.race([
        fn(...namespaceObjs, sandboxConsole),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`executor timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return { result, logs, metrics, nestedToolCalls };
    } catch (err) {
      return {
        result: undefined,
        error: err instanceof Error ? err.message : String(err),
        logs,
        metrics,
        nestedToolCalls,
      };
    }
  }
}
