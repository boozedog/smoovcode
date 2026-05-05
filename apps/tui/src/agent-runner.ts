import type { AgentRunOptions } from "@smoovcode/agent";
import {
  initialConversation,
  reduceConversation,
  type Block,
  type ConversationState,
  type TokenUsage,
} from "@smoovcode/ui-core";
import { ensureHighlighted } from "./highlight-cache.ts";
import {
  formatCodemodeResult,
  inferLangFromPath,
  isCodemodeInput,
  isWriteInput,
} from "./render-block.ts";

export interface AgentLike {
  run(
    message: string,
    opts?: { signal?: AbortSignal } & AgentRunOptions,
  ): AsyncIterable<Parameters<typeof reduceConversation>[1]>;
}

export interface AgentRunnerCallbacks {
  onBlockFinalize(block: Block, turnId: number): void;
  onLiveTextChange(blocks: Block[], turnId: number): void;
  onDone(turnId: number): void;
  onError(error: unknown): void;
  onUsage?(usage: TokenUsage): void;
  onRender(): void;
}

export class AgentRunner {
  private state: ConversationState = initialConversation;
  private emitted = new Set<string>();

  constructor(
    private readonly agent: AgentLike,
    private readonly message: string,
    private readonly callbacks: AgentRunnerCallbacks,
  ) {}

  async start(signal?: AbortSignal): Promise<void> {
    try {
      this.state = reduceConversation(this.state, {
        type: "turn-start",
        userMessage: this.message,
      });
      for await (const event of this.agent.run(this.message, { signal, showReasoning: true })) {
        this.state = reduceConversation(this.state, event);
        if (event.type === "usage")
          this.callbacks.onUsage?.({
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
          });
        await this.emitFinalBlocks();
        this.emitLiveText();
        this.callbacks.onRender();
      }
      this.state = reduceConversation(this.state, { type: "turn-end" });
      await this.emitFinalBlocks();
      const finalized = this.state.finalized.at(-1);
      this.callbacks.onLiveTextChange([], finalized?.id ?? 0);
      this.callbacks.onDone(finalized?.id ?? 0);
      this.callbacks.onRender();
    } catch (err) {
      this.callbacks.onLiveTextChange([], 0);
      this.callbacks.onError(err);
      this.callbacks.onRender();
    }
  }

  private async emitFinalBlocks(): Promise<void> {
    const turn = this.state.live ?? this.state.finalized.at(-1);
    if (!turn) return;
    for (const block of turn.blocks) {
      if (isBlockFinal(block) && !this.emitted.has(block.id)) {
        this.emitted.add(block.id);
        await ensureBlockHighlighted(block);
        this.callbacks.onBlockFinalize(block, turn.id);
      }
    }
  }

  private emitLiveText(): void {
    const turn = this.state.live;
    if (!turn) return;
    this.callbacks.onLiveTextChange(
      turn.blocks.filter(
        (block) =>
          (block.kind === "text" || block.kind === "reasoning") &&
          block.status === "streaming" &&
          !this.emitted.has(block.id),
      ),
      turn.id,
    );
  }
}

function isBlockFinal(block: Block): boolean {
  return (
    (block.kind === "text" && block.status === "done") ||
    (block.kind === "reasoning" && block.status === "done") ||
    (block.kind === "tool-call" && block.status !== "running") ||
    block.kind === "error"
  );
}

async function ensureBlockHighlighted(block: Block): Promise<void> {
  if (block.kind === "text") {
    await ensureHighlighted(block.text, "md");
    return;
  }
  if (block.kind !== "tool-call") return;

  if (block.name === "codemode" && isCodemodeInput(block.input)) {
    const tasks: Promise<unknown>[] = [ensureHighlighted(block.input.code, "ts")];
    if (block.status === "done")
      tasks.push(ensureHighlighted(formatCodemodeResult(block.output), "json"));
    await Promise.all(tasks);
    return;
  }

  if (block.name === "write" && isWriteInput(block.input)) {
    const lang = inferLangFromPath(block.input.path);
    if (lang) await ensureHighlighted(block.input.content, lang);
  }
}
