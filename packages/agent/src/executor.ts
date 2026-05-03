export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs?: string[];
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
 * decisions in the capability/tool layer (what providers are exposed, whether
 * they are read-only, and whether calls require approval), not in the choice of
 * executor alone.
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
