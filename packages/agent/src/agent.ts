import { createOpenAI } from "@ai-sdk/openai";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { type ApiMode, detectApiMode } from "./api-mode.ts";
import type { Executor } from "./executor.ts";
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
      tools: createTools(),
      executor: this.opts.executor,
    });

    const apiMode = await resolveApiMode();
    const modelId = this.opts.model ?? "gpt-5";
    const result = streamText({
      model: apiMode === "responses" ? provider.responses(modelId) : provider.chat(modelId),
      providerOptions: { openai: { store: !isZdr() } },
      system:
        this.opts.system ??
        "You are smoovcode, a coding agent. Use the codemode tool to call other tools by writing TypeScript.",
      messages: this.history,
      tools: { codemode },
      stopWhen: stepCountIs(10),
    });

    let assistantText = "";
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
      }
    }

    this.history.push({ role: "assistant", content: assistantText });
  }
}
