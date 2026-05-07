import { spawn } from "node:child_process";
import { isAbsolute, normalize, sep } from "node:path";
import { z } from "zod";

type CapabilityToolProvider = {
  name: string;
  tools: Record<string, { description?: string; execute: (args: unknown) => Promise<unknown> }>;
};

function sanitizeCapabilityToolName(name: string): string {
  const sanitized = name.replace(/[-.\s]/g, "_").replace(/[^a-zA-Z0-9_$]/g, "");
  if (sanitized === "") return "_";
  return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
}

export type CapabilitySafety = "read" | "write" | "external";
export type FlowEndpoint = "working-tree" | "git" | "github" | "network" | "secrets" | "user";

export interface CapabilityFlow {
  sources?: FlowEndpoint[];
  sinks?: FlowEndpoint[];
}

export interface InnerToolCall {
  parentTool?: string;
  capability: string;
  namespace: string;
  tool: string;
  input: unknown;
  safety: CapabilitySafety;
  flow?: CapabilityFlow;
}

export type PolicyDecision = { type: "allow" } | { type: "deny"; reason: string };

export interface CapabilityPolicy {
  beforeToolCall?(call: InnerToolCall): Promise<PolicyDecision> | PolicyDecision;
  checkFlow?(flow: {
    sources: FlowEndpoint[];
    sinks: FlowEndpoint[];
    call: InnerToolCall;
  }): Promise<PolicyDecision> | PolicyDecision;
  afterToolCall?(call: InnerToolCall, output: unknown): Promise<void> | void;
}

export interface CapabilityObserver {
  onInnerToolCallStart?(call: InnerToolCall): Promise<void> | void;
  onInnerToolCallEnd?(call: InnerToolCall, output: unknown): Promise<void> | void;
  onInnerToolCallError?(call: InnerToolCall, error: string): Promise<void> | void;
}

export interface CapabilityExecuteOptions {
  parentTool?: string;
}

export interface HostProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HostProcessOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env: NodeJS.ProcessEnv;
}

export type HostProcessRunner = (
  command: string,
  args: readonly string[],
  opts: HostProcessOptions,
) => Promise<HostProcessResult>;

export interface CapabilityContext {
  cwd: string;
  runner: HostProcessRunner;
  timeoutMs: number;
  maxOutputBytes: number;
  env: NodeJS.ProcessEnv;
}

export interface Capability<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  safety: CapabilitySafety;
  flow?: CapabilityFlow;
  execute(input: I, ctx: CapabilityContext): Promise<O>;
}

export const DEFAULT_CAPABILITY_TIMEOUT_MS = 15_000;
export const DEFAULT_CAPABILITY_MAX_OUTPUT_BYTES = 1_048_576;

export function defaultCapabilityEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

export async function spawnHostProcess(
  command: string,
  args: readonly string[],
  opts: HostProcessOptions,
): Promise<HostProcessResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = { stdout: "", stderr: "" };
    let killedForOutput = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs);

    function append(stream: "stdout" | "stderr", data: Buffer): void {
      chunks[stream] += data.toString("utf8");
      if (
        Buffer.byteLength(chunks.stdout) + Buffer.byteLength(chunks.stderr) >
        opts.maxOutputBytes
      ) {
        killedForOutput = true;
        child.kill("SIGTERM");
      }
    }

    child.stdout?.on("data", (data: Buffer) => append("stdout", data));
    child.stderr?.on("data", (data: Buffer) => append("stderr", data));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout: chunks.stdout, stderr: err.message, exitCode: 127 });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stderr = killedForOutput
        ? `${chunks.stderr}\n${command}: output exceeded ${opts.maxOutputBytes} bytes`.trimStart()
        : chunks.stderr;
      resolve({ stdout: chunks.stdout, stderr, exitCode: code ?? (signal ? 124 : 1) });
    });
  });
}

export function validateGitPath(path: string): string {
  if (path.trim() === "") throw new Error("git path must not be empty");
  if (path.startsWith("-")) throw new Error(`git path must not be an option: ${path}`);
  if (isAbsolute(path)) throw new Error(`git path must be relative: ${path}`);
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.startsWith("../")) {
    throw new Error(`git path escapes the project root via traversal: ${path}`);
  }
  return path;
}

function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,255}$/.test(ref) || ref.includes("..")) {
    throw new Error(`invalid git ref: ${ref}`);
  }
  return ref;
}

function capText(value: string, maxOutputBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxOutputBytes) return value;
  return `${value.slice(0, maxOutputBytes)}\n[truncated at ${maxOutputBytes} bytes]`;
}

async function runJson(ctx: CapabilityContext, args: readonly string[]): Promise<unknown> {
  const result = await ctx.runner("gh", args, ctx);
  if (result.exitCode !== 0) return result;
  if (result.stdout.trim() === "") return null;
  return JSON.parse(result.stdout);
}

async function runGit(ctx: CapabilityContext, args: readonly string[]): Promise<HostProcessResult> {
  const result = await ctx.runner("git", args, ctx);
  return {
    stdout: capText(result.stdout, ctx.maxOutputBytes),
    stderr: capText(result.stderr, ctx.maxOutputBytes),
    exitCode: result.exitCode,
  };
}

const issueStateSchema = z.enum(["open", "closed", "all"]);
const prStateSchema = z.enum(["open", "closed", "merged", "all"]);
const pathsSchema = z.array(z.string().transform(validateGitPath)).optional();

export function defaultCapabilities(): Capability[] {
  return [
    {
      name: "gh.issue.view",
      description: "View a GitHub issue as structured JSON by number.",
      inputSchema: z.object({ number: z.number().int().positive() }),
      safety: "read",
      flow: { sources: ["github"] },
      execute: ({ number }, ctx) =>
        runJson(ctx, [
          "issue",
          "view",
          String(number),
          "--json",
          "number,title,body,state,labels,assignees,author,url",
        ]),
    },
    {
      name: "gh.issue.list",
      description: "List GitHub issues as structured JSON.",
      inputSchema: z.object({
        state: issueStateSchema.optional(),
        labels: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      safety: "read",
      flow: { sources: ["github"] },
      execute: ({ state, labels, limit }, ctx) => {
        const args = ["issue", "list"];
        if (state) args.push("--state", state);
        for (const label of labels ?? []) args.push("--label", label);
        if (limit) args.push("--limit", String(limit));
        args.push("--json", "number,title,state,labels,assignees,author,url");
        return runJson(ctx, args);
      },
    },
    {
      name: "gh.issue.comment",
      description: "Comment on a GitHub issue with fixed, non-interactive gh argv.",
      inputSchema: z.object({ number: z.number().int().positive(), body: z.string().min(1) }),
      safety: "external",
      flow: { sinks: ["github"] },
      execute: async ({ number, body }, ctx) => {
        const result = await ctx.runner(
          "gh",
          ["issue", "comment", String(number), "--body", body],
          ctx,
        );
        return {
          stdout: capText(result.stdout, ctx.maxOutputBytes),
          stderr: capText(result.stderr, ctx.maxOutputBytes),
          exitCode: result.exitCode,
        };
      },
    },
    {
      name: "gh.issue.close",
      description: "Close a GitHub issue with fixed, non-interactive gh argv.",
      inputSchema: z.object({
        number: z.number().int().positive(),
        comment: z.string().min(1).optional(),
      }),
      safety: "external",
      flow: { sinks: ["github"] },
      execute: async ({ number, comment }, ctx) => {
        const args = ["issue", "close", String(number)];
        if (comment) args.push("--comment", comment);
        const result = await ctx.runner("gh", args, ctx);
        return {
          stdout: capText(result.stdout, ctx.maxOutputBytes),
          stderr: capText(result.stderr, ctx.maxOutputBytes),
          exitCode: result.exitCode,
        };
      },
    },
    {
      name: "gh.pr.view",
      description: "View a GitHub pull request as structured JSON by number.",
      inputSchema: z.object({ number: z.number().int().positive() }),
      safety: "read",
      execute: ({ number }, ctx) =>
        runJson(ctx, [
          "pr",
          "view",
          String(number),
          "--json",
          "number,title,body,state,author,headRefName,baseRefName,url",
        ]),
    },
    {
      name: "gh.pr.list",
      description: "List GitHub pull requests as structured JSON.",
      inputSchema: z.object({
        state: prStateSchema.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      safety: "read",
      execute: ({ state, limit }, ctx) => {
        const args = ["pr", "list"];
        if (state) args.push("--state", state);
        if (limit) args.push("--limit", String(limit));
        args.push("--json", "number,title,state,author,headRefName,baseRefName,url");
        return runJson(ctx, args);
      },
    },
    {
      name: "gh.repo.view",
      description: "View the current GitHub repository as structured JSON.",
      inputSchema: z.object({}).optional().default({}),
      safety: "read",
      execute: (_input, ctx) =>
        runJson(ctx, [
          "repo",
          "view",
          "--json",
          "name,nameWithOwner,description,url,defaultBranchRef",
        ]),
    },
    {
      name: "git.status",
      description: "Run git status --short --branch.",
      inputSchema: z.object({}).optional().default({}),
      safety: "read",
      execute: (_input, ctx) => runGit(ctx, ["status", "--short", "--branch"]),
    },
    {
      name: "git.diff",
      description: "Run git diff with an optional validated path list.",
      inputSchema: z.object({ paths: pathsSchema }),
      safety: "read",
      execute: ({ paths }, ctx) => runGit(ctx, ["diff", "--", ...(paths ?? [])]),
    },
    {
      name: "git.diffStat",
      description: "Run git diff --stat with an optional validated path list.",
      inputSchema: z.object({ paths: pathsSchema }),
      safety: "read",
      execute: ({ paths }, ctx) => runGit(ctx, ["diff", "--stat", "--", ...(paths ?? [])]),
    },
    {
      name: "git.log",
      description: "Run git log --oneline --decorate with a bounded max count.",
      inputSchema: z.object({ maxCount: z.number().int().min(1).max(100).optional() }),
      safety: "read",
      execute: ({ maxCount }, ctx) =>
        runGit(ctx, ["log", "--oneline", "--decorate", `--max-count=${maxCount ?? 20}`]),
    },
    {
      name: "git.show",
      description: "Run git show for a validated ref.",
      inputSchema: z.object({ ref: z.string().transform(validateRef) }),
      safety: "read",
      execute: ({ ref }, ctx) => runGit(ctx, ["show", "--no-ext-diff", ref]),
    },
    {
      name: "git.branchList",
      description: "Run git branch --list --all.",
      inputSchema: z.object({}).optional().default({}),
      safety: "read",
      execute: (_input, ctx) => runGit(ctx, ["branch", "--list", "--all"]),
    },
  ];
}

export interface CapabilityRegistryOptions {
  cwd?: string;
  runner?: HostProcessRunner;
  capabilities?: readonly Capability[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  observer?: CapabilityObserver;
  policy?: CapabilityPolicy;
}

export class CapabilityRegistry {
  private readonly byName: Map<string, Capability>;
  private readonly ctx: CapabilityContext;
  private readonly observer?: CapabilityObserver;
  private readonly policy?: CapabilityPolicy;
  private readonly executionTaint = new Set<FlowEndpoint>();

  constructor(opts: CapabilityRegistryOptions = {}) {
    this.byName = new Map(
      (opts.capabilities ?? defaultCapabilities()).map((cap) => [cap.name, cap]),
    );
    this.ctx = {
      cwd: opts.cwd ?? process.cwd(),
      runner: opts.runner ?? spawnHostProcess,
      timeoutMs: opts.timeoutMs ?? DEFAULT_CAPABILITY_TIMEOUT_MS,
      maxOutputBytes: opts.maxOutputBytes ?? DEFAULT_CAPABILITY_MAX_OUTPUT_BYTES,
      env: defaultCapabilityEnv(opts.env),
    };
    this.observer = opts.observer;
    this.policy = opts.policy;
  }

  names(): string[] {
    return [...this.byName.keys()].sort();
  }

  get(name: string): Capability | undefined {
    return this.byName.get(name);
  }

  async execute(
    name: string,
    input: unknown,
    opts: CapabilityExecuteOptions = {},
  ): Promise<unknown> {
    const cap = this.byName.get(name);
    if (!cap) throw new Error(`unknown capability: ${name}`);
    const parsed = cap.inputSchema.parse(input);
    const [namespace, ...rest] = name.split(".");
    const call: InnerToolCall = {
      parentTool: opts.parentTool,
      capability: name,
      namespace: namespace ?? "",
      tool: sanitizeCapabilityToolName(rest.join(".")),
      input,
      safety: cap.safety,
      flow: cap.flow,
    };
    await this.observer?.onInnerToolCallStart?.(call);
    try {
      await this.enforcePolicy(call);
      const output = await cap.execute(parsed, this.ctx);
      for (const source of cap.flow?.sources ?? []) this.executionTaint.add(source);
      await this.observer?.onInnerToolCallEnd?.(call, output);
      await this.policy?.afterToolCall?.(call, output);
      return output;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.observer?.onInnerToolCallError?.(call, error);
      throw err;
    }
  }

  private async enforcePolicy(call: InnerToolCall): Promise<void> {
    const before = await this.policy?.beforeToolCall?.(call);
    if (before?.type === "deny") throw new Error(before.reason);
    const sinks = call.flow?.sinks ?? [];
    if (sinks.length > 0) {
      const decision = await this.policy?.checkFlow?.({
        sources: [...this.executionTaint],
        sinks,
        call,
      });
      if (decision?.type === "deny") throw new Error(decision.reason);
    }
  }

  toProviders(): Array<{
    name: string;
    fns: Record<string, (input: unknown) => Promise<unknown>>;
  }> {
    const groups = new Map<string, Record<string, (input: unknown) => Promise<unknown>>>();
    for (const name of this.names()) {
      const [namespace, ...rest] = name.split(".");
      const fnName = rest.join(".");
      const fns = groups.get(namespace) ?? {};
      fns[fnName] = (input: unknown) => this.execute(name, input, { parentTool: "codemode" });
      groups.set(namespace, fns);
    }
    return [...groups.entries()].map(([name, fns]) => ({ name, fns }));
  }

  toToolProviders(): CapabilityToolProvider[] {
    return this.toProviders().map((provider) => ({
      name: provider.name,
      tools: Object.fromEntries(
        Object.entries(provider.fns).map(([name, execute]) => [
          sanitizeCapabilityToolName(name),
          { description: this.byName.get(`${provider.name}.${name}`)?.description, execute },
        ]),
      ),
    }));
  }
}

export function createDefaultCapabilityRegistry(
  opts: CapabilityRegistryOptions = {},
): CapabilityRegistry {
  return new CapabilityRegistry(opts);
}
