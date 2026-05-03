import { createOpenAI } from "@ai-sdk/openai";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { type ApiMode, detectApiMode } from "./api-mode.ts";
import type { Executor } from "./executor.ts";
import type { HostApprover } from "./host-exec.ts";
import { isReadOnlyArgv, type Mode, modeSystemPrompt } from "./mode.ts";
import { createTools, type CreateToolsOptions } from "./tools.ts";

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
  /**
   * Approval callback for host execution. Called once per host argv before
   * spawn. Defaults to deny-all when omitted.
   */
  approveHost?: HostApprover;
  /**
   * Default operating mode for `run()`. May be overridden per-call via the
   * second argument to `run()`. Defaults to `"edit"`.
   */
  mode?: Mode;
}

export interface AgentRunOptions {
  /** Override the agent's default mode for this turn only. */
  mode?: Mode;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown }
  | { type: "tool-error"; name: string; error: string }
  | { type: "error"; error: string };

export class Agent {
  private readonly history: ModelMessage[] = [];

  constructor(private readonly opts: AgentOptions) {}

  async *run(userMessage: string, runOpts?: AgentRunOptions): AsyncGenerator<AgentEvent> {
    this.history.push({ role: "user", content: userMessage });

    const mode: Mode = runOpts?.mode ?? this.opts.mode ?? "edit";
    const toolsOpts: CreateToolsOptions = {
      ...(this.opts.cwd !== undefined ? { cwd: this.opts.cwd } : {}),
      ...(this.opts.approveHost ? { approveHost: this.opts.approveHost } : {}),
      ...(mode === "plan" ? { bashArgvGuard: isReadOnlyArgv } : {}),
    };
    const { bash, astGrep, write, edit } = createTools(toolsOpts);
    // The split: today's read-style capabilities (bash, astGrep) live inside
    // codemode for orchestration (loops, Promise.all, intermediate values).
    // Mutating capabilities (write, edit) are top-level tools so each mutation
    // is a discrete, scrollback-visible event the harness can render and gate
    // on. This is a capability policy, not an executor guarantee: any
    // mutating tool exposed to codemode could still mutate via its host bridge.
    const codemode = createCodeTool({
      tools: { bash, astGrep },
      executor: this.opts.executor,
    });

    const baseSystem = this.opts.system ?? DEFAULT_SYSTEM_PROMPT;
    const modePrompt = modeSystemPrompt(mode);
    const system = modePrompt ? `${baseSystem}\n\n${modePrompt}` : baseSystem;

    // Plan mode drops the known mutating top-level tools entirely so the model
    // can't even attempt them — combined with the bash argv guard above, this
    // closes off the currently exposed mutation paths. Do not rely on the
    // executor itself as a mutation boundary; new codemode tools must be
    // classified/gated by capability.
    const tools: { codemode: typeof codemode; write?: typeof write; edit?: typeof edit } =
      mode === "plan" ? { codemode } : { codemode, write, edit };

    const apiMode = await resolveApiMode();
    const modelId = this.opts.model ?? "gpt-5";
    const result = streamText({
      model: apiMode === "responses" ? provider.responses(modelId) : provider.chat(modelId),
      providerOptions: { openai: { store: !isZdr() } },
      system,
      messages: this.history,
      tools,
      stopWhen: stepCountIs(30),
    });

    let assistantText = "";
    let finishReason: string | undefined;
    let stepCount = 0;
    for await (const part of result.fullStream) {
      if (process.env.SMOOV_DEBUG) {
        if (part.type === "start-step") {
          const body = (part as { request?: { body?: unknown } }).request?.body;
          process.stderr.write(`[debug] start-step body=${JSON.stringify(body)}\n`);
        } else {
          process.stderr.write(`[debug] ${part.type}\n`);
        }
      }
      if (part.type === "text-delta") {
        assistantText += part.text;
        yield { type: "text", delta: part.text };
      } else if (part.type === "reasoning-delta") {
        yield { type: "reasoning", delta: part.text };
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
      } else if (part.type === "finish") {
        finishReason = (part as { finishReason?: string }).finishReason;
      }
    }

    if (assistantText === "" && finishReason && finishReason !== "stop") {
      yield { type: "error", error: explainSilentFinish(finishReason, stepCount) };
    }

    this.history.push({ role: "assistant", content: assistantText });
  }
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
- Pass a single async TypeScript arrow function that drives the currently exposed read-style tools: \`codemode.bash(...)\` and \`codemode.astGrep(...)\`.
- Use it for grep / find / cat / ls / ast-grep, multi-step exploration, filtering, summarizing, parallel reads via \`Promise.all\`, and computing edit plans.
- Tool result shapes — read them, don't guess. Tool results are objects, not arrays. \`astGrep\` returns \`{ matches: [...] }\`, \`bash\` returns \`{ stdout, stderr, exitCode }\`. Reading \`result.length\` on these silently yields \`undefined\` (and serializes as \`{}\`), which is the most common reason for an analysis loop to stall. If you're unsure of a tool's return shape, do one small probe call and \`return\` the raw value before building on top of it.
- Console output is captured. Anything you \`console.log\` / \`console.error\` inside a codemode block is returned alongside the result and visible to you on the next turn. Use it freely to introspect intermediate values.
- The executor is not a mutation boundary. Codemode is read-only only because the tools exposed there are treated as read-style capabilities: \`codemode.bash\` writes are in-memory only and discarded after the call, and \`codemode.astGrep\` only searches. If a mutating tool is exposed to codemode, it can mutate through its host/tool bridge.

\`write\` and \`edit\` (mutations, top-level):
- \`write({ path, content })\` creates or overwrites a file with full contents. Use for new files or whole-file rewrites.
- \`edit({ path, oldString, newString, replaceAll? })\` replaces a substring; \`oldString\` must be unique unless \`replaceAll: true\`. Use for surgical edits.
- Each call is one atomic, user-visible mutation. Prefer many small \`edit\` calls over one large \`write\` when you're patching an existing file — the diffs are clearer and a failure leaves the rest intact.
- Compute the plan inside \`codemode\` (read files, decide changes), then emit \`write\` / \`edit\` calls outside it. Don't try to mutate inside codemode; this keeps mutations atomic and visible rather than relying on the executor to prevent side effects.

Step economy:
- Each top-level tool call is one step (max 30). Batch reads inside a single codemode block where you can.
- End every turn with a final text response — never finish silently after a tool call.`;
