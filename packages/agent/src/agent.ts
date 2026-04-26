import { createOpenAI } from "@ai-sdk/openai";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { type ApiMode, detectApiMode } from "./api-mode.ts";
import type { Executor } from "./executor.ts";
import type { HostApprover } from "./host-exec.ts";
import { createTools } from "./tools.ts";

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

  async *run(userMessage: string): AsyncGenerator<AgentEvent> {
    this.history.push({ role: "user", content: userMessage });

    const codemode = createCodeTool({
      tools: createTools({
        ...(this.opts.cwd !== undefined ? { cwd: this.opts.cwd } : {}),
        ...(this.opts.approveHost ? { approveHost: this.opts.approveHost } : {}),
      }),
      executor: this.opts.executor,
    });

    const apiMode = await resolveApiMode();
    const modelId = this.opts.model ?? "gpt-5";
    const result = streamText({
      model: apiMode === "responses" ? provider.responses(modelId) : provider.chat(modelId),
      providerOptions: { openai: { store: !isZdr() } },
      system: this.opts.system ?? DEFAULT_SYSTEM_PROMPT,
      messages: this.history,
      tools: { codemode },
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

const DEFAULT_SYSTEM_PROMPT = `You are smoovcode, a coding agent. You operate by calling the \`codemode\` tool with a single async TypeScript arrow function that drives the other tools.

Tool result shapes — read them, don't guess:
- Tool results are objects, not arrays. \`astGrep\` returns \`{ matches: [...] }\`, \`bash\` returns \`{ stdout, stderr, exitCode }\`. Reading \`result.length\` on these silently yields \`undefined\` (and serializes as \`{}\`), which is the most common reason for an analysis loop to stall.
- If you're unsure of a tool's return shape, do one small probe call and \`return\` the raw value before building on top of it.

Console output is captured:
- Anything you \`console.log\` / \`console.error\` inside a codemode block is returned alongside the result and visible to you on the next turn. Use it freely to introspect intermediate values; you don't need to fold every log into the return value.

Be economical with steps:
- Each \`codemode\` call is one step. Prefer one well-targeted call that returns a structured object over many speculative calls.
- For a research / analysis task, plan the queries first, then issue them in a batch, then summarize. End every turn with a final text response — never finish silently after a tool call.`;
