import type { Block, TokenUsage } from "@smoovcode/ui-core";
import { PromptModel } from "./prompt-model.ts";
import { renderBlock } from "./render-block.ts";
import { contextWindowForModel, formatStatusLine, type SessionStats } from "./status-line.ts";

export type StaticItem =
  | { kind: "banner"; key: string; lines: string[] }
  | { kind: "user"; key: string; userMessage: string }
  | { kind: "block"; key: string; block: Block };

export class TuiAppModel {
  readonly prompt = new PromptModel();
  readonly staticItems: StaticItem[];
  liveItems: StaticItem[] = [];
  pendingMessage: string | null = null;
  keyCounter = 0;
  expandedCodemodeIds = new Set<string>();
  expandedReasoningIds = new Set<string>();
  private readonly stats?: SessionStats;

  constructor(opts: { banner: string | string[]; stats?: SessionStats }) {
    this.stats = opts.stats ? { ...opts.stats } : undefined;
    if (this.stats?.contextWindow === undefined && this.stats?.model) {
      this.stats.contextWindow = contextWindowForModel(this.stats.model);
    }
    this.staticItems = [
      {
        kind: "banner",
        key: "banner",
        lines: Array.isArray(opts.banner) ? opts.banner : [opts.banner],
      },
    ];
  }

  submit(message: string): void {
    this.liveItems = [];
    this.staticItems.push({ kind: "user", key: `u-${this.keyCounter}`, userMessage: message });
    this.pendingMessage = message;
    this.keyCounter += 1;
  }

  addBlock(block: Block, key = `b-${this.keyCounter}-${block.id}`): void {
    this.staticItems.push({ kind: "block", key, block });
  }

  setLiveBlocks(blocks: Block[], turnId: number): void {
    this.liveItems = blocks.map((block) => ({
      kind: "block",
      key: `live-${turnId}-${block.id}`,
      block,
    }));
  }

  finishTurn(): void {
    this.liveItems = [];
    this.pendingMessage = null;
  }

  addUsage(usage: TokenUsage): void {
    if (!this.stats) return;
    this.stats.inputTokens = (this.stats.inputTokens ?? 0) + usage.inputTokens;
    this.stats.outputTokens = (this.stats.outputTokens ?? 0) + usage.outputTokens;
  }

  addError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.liveItems = [];
    this.addBlock(
      { kind: "error", id: `err-${this.keyCounter}`, error: message, status: "done" },
      `err-${this.keyCounter}`,
    );
    this.pendingMessage = null;
  }

  toggleCodemodeExpansion(): void {
    const codemodeIds = this.currentCodemodeBlockIds();
    const allExpanded =
      codemodeIds.length > 0 && codemodeIds.every((id) => this.expandedCodemodeIds.has(id));
    this.expandedCodemodeIds = allExpanded ? new Set() : new Set(codemodeIds);
  }

  toggleReasoningExpansion(): void {
    const reasoningIds = this.currentReasoningBlockIds();
    const allExpanded =
      reasoningIds.length > 0 && reasoningIds.every((id) => this.expandedReasoningIds.has(id));
    this.expandedReasoningIds = allExpanded ? new Set() : new Set(reasoningIds);
  }

  private currentCodemodeBlockIds(): string[] {
    return [...this.staticItems, ...this.liveItems].flatMap((item) =>
      item.kind === "block" && item.block.kind === "tool-call" && item.block.name === "codemode"
        ? [item.block.id]
        : [],
    );
  }

  private currentReasoningBlockIds(): string[] {
    return [...this.staticItems, ...this.liveItems].flatMap((item) =>
      item.kind === "block" && item.block.kind === "reasoning" ? [item.block.id] : [],
    );
  }

  renderFrame(
    now = Date.now(),
    startedAt?: number,
    opts: { focused?: boolean; cursorVisible?: boolean } = {},
  ): { lines: string[]; cursor?: { line: number; column: number } } {
    const lines: string[] = [];
    let cursor: { line: number; column: number } | undefined;
    for (const item of [...this.staticItems, ...this.liveItems]) {
      if (item.kind === "banner") lines.push(...item.lines);
      else if (item.kind === "user") lines.push("", `> ${item.userMessage}`);
      else
        lines.push(
          "",
          ...renderBlock(item.block, {
            expandedCodemode: this.expandedCodemodeIds.has(item.block.id),
            expandedReasoning: this.expandedReasoningIds.has(item.block.id),
          }),
        );
    }

    if (this.pendingMessage !== null)
      lines.push("", `working ${formatElapsed(now - (startedAt ?? now))}`);

    if (this.pendingMessage === null) {
      const promptStart = lines.length + 1;
      lines.push("", ...this.prompt.renderLines(opts));
      const promptLine = promptStart + this.prompt.lines.length - 1;
      const promptPrefix = this.prompt.lines.length === 1 ? "> " : "... ";
      cursor = {
        line: promptLine,
        column: promptPrefix.length + this.prompt.lines[this.prompt.lines.length - 1].length,
      };
    }

    const status = renderStatus(this.stats);
    if (status) lines.push(...status.split("\n"));

    return { lines, ...(cursor ? { cursor } : {}) };
  }

  renderLines(now = Date.now(), startedAt?: number): string[] {
    return this.renderFrame(now, startedAt).lines;
  }
}

function renderStatus(stats?: SessionStats): string {
  return stats ? formatStatusLine(stats) : "";
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}
