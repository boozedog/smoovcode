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
