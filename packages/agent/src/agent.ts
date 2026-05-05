import { createOpenAI } from "@ai-sdk/openai";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { type ApiMode, detectApiMode } from "./api-mode.ts";
import { createDefaultCapabilityRegistry } from "./capabilities.ts";
import type { Executor } from "./executor.ts";
import { createToolSession, type ToolSession } from "./tool-session.ts";

const baseURL = process.env.SMOOV_BASE_URL ?? "https://api.openai.com/v1";
const apiKey = process.env.SMOOV_API_KEY ?? process.env.OPENAI_API_KEY;

const provider = createOpenAI({ baseURL, apiKey });

async function resolveApiMode(): Promise<ApiMode> {
  const forced = process.env.SMOOV_API_MODE;
  if (forced === "responses" || forced === "chat") return forced;
  // ZDR providers can't use Responses' server-state features and have
  // silently broken tool-result threading. Skip the probe and use chat.
  if (isZdr()) return "chat";
  return detectApiMode({ baseUrl: baseURL, apiKey });
}

// ZDR (Zero Data Retention) providers don't store request items server-side,
// so AI SDK's default `store: true` produces item_reference IDs that resolve
// to nothing — the model can't see prior tool calls and re-loops. Turning
// store off forces full inline payloads with matching call_ids.
function isZdr(): boolean {
  const env = process.env.SMOOV_ZDR?.toLowerCase();
  if (env === "true" || env === "1") return true;
  if (env === "false" || env === "0") return false;
  // Heuristic: real OpenAI stores by default, anyone else probably doesn't.
  return !baseURL.includes("api.openai.com");
}

export interface AgentOptions {
  executor: Executor;
  model?: string;
  system?: string;
  /** Project root exposed to the tools. Defaults to process.cwd(). */
  cwd?: string;
  /** Existing tool session. Defaults to a new session owned by this Agent. */
  session?: ToolSession;
}

export interface AgentRunOptions {
  verbose?: boolean;
  showReasoning?: boolean;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown }
  | { type: "tool-error"; name: string; error: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: string }
  | { type: "debug"; label: string; data: unknown };

export class Agent {
  private readonly history: ModelMessage[] = [];
  readonly session: ToolSession;

  constructor(private readonly opts: AgentOptions) {
    this.session =
      opts.session ?? createToolSession(opts.cwd !== undefined ? { cwd: opts.cwd } : {});
  }

  async *run(userMessage: string, runOpts: AgentRunOptions = {}): AsyncGenerator<AgentEvent> {
    this.history.push({ role: "user", content: userMessage });

    const cwd = this.opts.cwd ?? process.cwd();
    const { sh, astGrep, write, edit } = this.session.tools({ cwd });
    const hostCapabilities = createDefaultCapabilityRegistry({ cwd });
    // The split: today's read-style capabilities live inside codemode for
    // orchestration (loops, Promise.all, intermediate values).
    // Mutating capabilities (write, edit) are top-level tools so each mutation
    // is a discrete, scrollback-visible event the harness can render and gate
    // on. This is a capability policy, not an executor guarantee: keep
    // mutating tools out of codemode unless they are safe to call there.
    const codemode = createCodeTool({
      tools: [
        { tools: { astGrep } },
        { name: "sh", tools: sh },
        ...hostCapabilities.toToolProviders(),
      ],
      executor: this.opts.executor,
    });

    const system = this.opts.system ?? DEFAULT_SYSTEM_PROMPT;
    const tools: { codemode: typeof codemode; write: typeof write; edit: typeof edit } = {
      codemode,
      write,
      edit,
    };

    const apiMode = await resolveApiMode();
    const modelId = this.opts.model ?? "gpt-5";
    const showReasoning = runOpts.verbose === true || runOpts.showReasoning === true;
    const result = streamText({
      model: apiMode === "responses" ? provider.responses(modelId) : provider.chat(modelId),
      providerOptions: {
        openai: {
          store: !isZdr(),
          ...(showReasoning ? { reasoningSummary: "auto" } : {}),
        },
      },
      system,
      messages: this.history,
      tools,
      stopWhen: stepCountIs(30),
      includeRawChunks: showReasoning,
    });

    let assistantText = "";
    let finishReason: string | undefined;
    let stepCount = 0;
    for await (const part of result.fullStream) {
      if (runOpts.verbose) {
        yield { type: "debug", label: "raw-stream-part", data: part };
      }
      if (process.env.SMOOV_DEBUG) {
        if (part.type === "start-step") {
          const body = (part as { request?: { body?: unknown } }).request?.body;
          process.stderr.write(`[debug] start-step body=${JSON.stringify(body)}\n`);
        } else {
          process.stderr.write(`[debug] ${part.type}\n`);
        }
      }
      if (part.type === "text-delta") {
        const delta = getStreamDelta(part);
        assistantText += delta;
        yield { type: "text", delta };
      } else if (part.type === "reasoning-delta") {
        yield { type: "reasoning", delta: getStreamDelta(part) };
      } else if (part.type === "raw") {
        const reasoning = extractRawReasoning(part.rawValue);
        if (reasoning) yield { type: "reasoning", delta: reasoning };
      } else if (part.type === "tool-call") {
        yield { type: "tool-call", name: part.toolName, input: part.input };
      } else if (part.type === "tool-result") {
        yield { type: "tool-result", name: part.toolName, output: part.output };
      } else if (part.type === "tool-error") {
        yield {
          type: "tool-error",
          name: part.toolName,
          error: part.error instanceof Error ? part.error.message : String(part.error),
        };
      } else if (part.type === "error") {
        yield { type: "error", error: String(part.error) };
      } else if (part.type === "start-step") {
        stepCount += 1;
      } else if (part.type === "finish-step") {
        if (part.usage) {
          yield {
            type: "usage",
            inputTokens: part.usage.inputTokens ?? 0,
            outputTokens: part.usage.outputTokens ?? 0,
          };
        }
      } else if (part.type === "finish") {
        finishReason = (part as { finishReason?: string }).finishReason;
        if (part.totalUsage) {
          yield {
            type: "usage",
            inputTokens: part.totalUsage.inputTokens ?? 0,
            outputTokens: part.totalUsage.outputTokens ?? 0,
          };
        }
      }
    }

    if (assistantText === "" && finishReason && finishReason !== "stop") {
      yield { type: "error", error: explainSilentFinish(finishReason, stepCount) };
    }

    this.history.push({ role: "assistant", content: assistantText });
  }
}

function getStreamDelta(part: { text?: string; delta?: string }): string {
  return part.delta ?? part.text ?? "";
}

function extractRawReasoning(rawValue: unknown): string {
  if (!isRecord(rawValue)) return "";
  const choices = rawValue.choices;
  if (!Array.isArray(choices)) return "";
  return choices.map(extractChoiceReasoning).filter(Boolean).join("");
}

function extractChoiceReasoning(choice: unknown): string {
  if (!isRecord(choice)) return "";
  const delta = choice.delta;
  if (!isRecord(delta)) return "";
  const reasoning = delta.reasoning_content ?? delta.reasoningContent;
  return typeof reasoning === "string" ? reasoning : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function explainSilentFinish(finishReason: string, stepCount: number): string {
  const steps = `${stepCount} step${stepCount === 1 ? "" : "s"}`;
  switch (finishReason) {
    case "tool-calls":
      return `agent ended with no response after ${steps} (finishReason=tool-calls). The step budget was likely exhausted before the model produced a final answer — try a smaller request or break it into pieces.`;
    case "length":
      return `agent ended with no response after ${steps} (finishReason=length). The model hit its output token limit before producing a final answer.`;
    case "content-filter":
      return `agent ended with no response after ${steps} (finishReason=content-filter). The model's output was blocked by a content filter.`;
    case "error":
      return `agent ended with no response after ${steps} (finishReason=error). The model returned an error mid-stream.`;
    default:
      return `agent ended with no response after ${steps} (finishReason=${finishReason}).`;
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are smoovcode, a coding agent. You have two tool surfaces — use the right one for the job.

\`codemode\` (reads, orchestration):
- Pass a single async TypeScript arrow function that drives the currently exposed read-style tools: \`sh.rg(...)\`, \`sh.cat(...)\`, \`codemode.astGrep(...)\`, \`gh.issue_view(...)\`, \`gh.issue_list(...)\`, \`gh.pr_view(...)\`, \`gh.repo_view(...)\`, \`git.status(...)\`, \`git.diff(...)\`, \`git.log(...)\`, etc.
- Use \`sh.*\` for reviewed sandbox commands, \`git.*\` for git information, and \`gh.*\` for GitHub information. The old generic bash escape hatch is not exposed inside codemode; call typed capabilities such as \`sh.rg({ args: [...] })\`, \`sh.cat({ args: [...] })\`, and \`sh.find({ args: [...] })\` instead.
- Use it for grep / find / cat / ls / ast-grep, curated GitHub/Git context, multi-step exploration, filtering, summarizing, parallel reads via \`Promise.all\`, and computing edit plans. The sandbox cwd is the virtual mounted project directory \`/projects/<folder-name>\`.
- Tool result shapes — read them, don't guess. Tool results are objects, not arrays. \`astGrep\` returns \`{ matches: [...] }\`; \`sh.*\` commands return \`{ stdout, stderr, exitCode }\`. Reading \`result.length\` on these silently yields \`undefined\` (and serializes as \`{}\`), which is the most common reason for an analysis loop to stall. If you're unsure of a tool's return shape, do one small probe call and \`return\` the raw value before building on top of it.
- Console output is captured. Anything you \`console.log\` / \`console.error\` inside a codemode block is returned alongside the result and visible to you on the next turn. Use it freely to introspect intermediate values.
- The executor is not a mutation boundary. Side effects come from exposed capabilities: sandbox \`sh.*\` commands run in the mounted project filesystem, \`astGrep\` searches files, and \`gh.*\` / \`git.*\` are fixed-argv typed host wrappers with no raw command passthrough.

\`write\` and \`edit\` (top-level file mutations):
- \`write({ path, content })\` creates or overwrites a project file with full contents. Use for new files or whole-file rewrites.
- \`edit({ path, oldString, newString, replaceAll? })\` performs a substring replacement; \`oldString\` must be unique unless \`replaceAll: true\`. Use for surgical edits.
- File changes update the real working tree immediately through the mounted, root-bounded project filesystem.
- Prefer many small \`edit\` calls over one large \`write\` when you're patching an existing file — the diffs are clearer and a failure leaves the rest intact.

Step economy:
- Each top-level tool call is one step (max 30). Batch reads inside a single codemode block where you can.
- End every turn with a final text response — never finish silently after a tool call.`;
