export interface ExecuteMetrics {
  toolCalls: number;
  toolInputBytes: number;
  toolOutputBytes: number;
}

export interface ExecuteNestedToolCall {
  id: string;
  provider: string;
  name: string;
  status: "done" | "error";
  inputBytes: number;
  outputBytes?: number;
  error?: string;
}

export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs?: string[];
  metrics?: ExecuteMetrics;
  nestedToolCalls?: ExecuteNestedToolCall[];
}

export type ToolFns = Record<string, (...args: unknown[]) => Promise<unknown>>;

export interface ResolvedProvider {
  name: string;
  fns: ToolFns;
  positionalArgs?: boolean;
}

export type Providers = ResolvedProvider[] | ToolFns;

/**
 * Runs model-authored codemode orchestration code.
 *
 * An Executor is not a mutation boundary: any provider function exposed to the
 * code can perform whatever side effects that host function allows. Keep safety
 * decisions in the capability/tool layer (what providers are exposed, what
 * filesystem or host resources they can reach, and whether calls require
 * approval), not in the choice of executor alone.
 */
export interface Executor {
  readonly name: string;
  execute(code: string, providers: Providers): Promise<ExecuteResult>;
}

// Codemode 0.3+ passes ResolvedProvider[]; older versions passed a flat record
// keyed by tool name (implicitly under the "codemode" namespace).
export function normalizeProviders(providers: Providers): ResolvedProvider[] {
  if (Array.isArray(providers)) return providers;
  return [{ name: "codemode", fns: providers }];
}

export function serializedByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return Buffer.byteLength(serialized ?? "", "utf8");
}

export function createEmptyMetrics(): ExecuteMetrics {
  return { toolCalls: 0, toolInputBytes: 0, toolOutputBytes: 0 };
}

export function wrapProvidersWithMetrics(
  providers: ResolvedProvider[],
  metrics: ExecuteMetrics,
  nestedToolCalls: ExecuteNestedToolCall[] = [],
): ResolvedProvider[] {
  return providers.map((provider) => ({
    ...provider,
    fns: Object.fromEntries(
      Object.entries(provider.fns).map(([name, fn]) => [
        name,
        async (...args: unknown[]) => {
          const inputBytes = serializedByteLength(args.length === 1 ? args[0] : args);
          const call: ExecuteNestedToolCall = {
            id: `${nestedToolCalls.length}`,
            provider: provider.name,
            name,
            status: "done",
            inputBytes,
          };
          nestedToolCalls.push(call);
          metrics.toolCalls += 1;
          metrics.toolInputBytes += inputBytes;
          try {
            const result = await fn(...args);
            const outputBytes = serializedByteLength(result);
            metrics.toolOutputBytes += outputBytes;
            call.outputBytes = outputBytes;
            return result;
          } catch (err) {
            call.status = "error";
            call.error = err instanceof Error ? err.message : String(err);
            throw err;
          }
        },
      ]),
    ),
  }));
}
