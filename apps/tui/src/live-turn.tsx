import { type Block, type TokenUsage } from "@smoovcode/ui-core";
import { type AgentLike, useAgentSession, useTickFlush } from "@smoovcode/ui-react";
import { Box, Text } from "ink";
import { createElement, useRef, useState, type ReactElement } from "react";
import {
  formatCodemodeResult,
  inferLangFromPath,
  isCodemodeInput,
  isWriteInput,
} from "./block-view.tsx";
import { ensureHighlighted } from "./highlight-cache.ts";
import { Spinner } from "./spinner.tsx";

interface LiveTurnProps {
  agent: AgentLike;
  message: string;
  /**
   * Called once per block as it transitions out of streaming/running into a
   * terminal state. App promotes the block into `<Static>` scrollback.
   */
  onBlockFinalize: (block: Block, turnId: number) => void;
  /** Called once when the turn-end event has finalized all blocks. */
  onTurnDone: (turnId: number) => void;
  /** Current streaming assistant text blocks. Tool-call blocks intentionally do not stream. */
  onLiveTextChange?: (blocks: Block[], turnId: number) => void;
  onError?: (err: unknown) => void;
}

function visibleTextBlocks(blocks: Block[], displayed: ReadonlySet<string>): Block[] {
  return blocks.filter((b) => b.kind === "text" && !displayed.has(b.id));
}

function liveTextSignature(blocks: Block[], turnId: number): string {
  return `${turnId}:${blocks.map((b) => `${b.id}:${b.kind === "text" ? b.text : ""}`).join("|")}`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

interface WorkingStatsProps {
  startedAt: number;
  usage?: TokenUsage;
}

function WorkingStats({ startedAt, usage }: WorkingStatsProps): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useTickFlush(() => setNow(Date.now()), 250);

  const details = [formatElapsed(now - startedAt)];
  if (usage) {
    details.push(`${formatTokenCount(usage.outputTokens)} out`);
    details.push(`${formatTokenCount(usage.inputTokens)} in`);
  }

  return createElement(Text, { dimColor: true }, `working ${details.join(" · ")}`);
}

function isBlockFinal(b: Block): boolean {
  return (
    (b.kind === "text" && b.status === "done") ||
    (b.kind === "reasoning" && b.status === "done") ||
    (b.kind === "tool-call" && b.status !== "running") ||
    b.kind === "error"
  );
}

/**
 * Pre-warm the highlight cache for every string `BlockView` will pass to
 * `HighlightedCode` for this block. Once this resolves, the block can render
 * inside `<Static>` and pick up the ANSI version on its first frame.
 */
async function ensureBlockHighlighted(b: Block): Promise<void> {
  if (b.kind === "text") {
    await ensureHighlighted(b.text, "md");
    return;
  }
  if (b.kind !== "tool-call") return;
  if (b.name === "codemode" && isCodemodeInput(b.input)) {
    const tasks: Promise<unknown>[] = [ensureHighlighted(b.input.code, "ts")];
    if (b.status === "done") {
      tasks.push(ensureHighlighted(formatCodemodeResult(b.output), "json"));
    }
    await Promise.all(tasks);
    return;
  }
  if (b.name === "write" && isWriteInput(b.input)) {
    const lang = inferLangFromPath(b.input.path);
    if (lang) await ensureHighlighted(b.input.content, lang);
  }
}

/**
 * Live region for one in-progress turn. Deliberately bounded to a fixed
 * number of lines in the fixed bottom pane: an animated "working" indicator
 * plus one indented animated indicator per currently-running
 * tool-call. Streaming text/reasoning are not rendered live — they emit to
 * scrollback once finalized via `onBlockFinalize`. (If you want to watch the
 * model think token-by-token, use the CLI.)
 */
export function LiveTurn({
  agent,
  message,
  onBlockFinalize,
  onTurnDone,
  onLiveTextChange,
  onError,
}: LiveTurnProps): ReactElement | null {
  const startedAtRef = useRef(Date.now());
  const session = useAgentSession({ agent, message });
  const live = session.conversation.live;
  const finalized = session.conversation.finalized.at(-1);
  const turn = live ?? finalized;

  const emittedRef = useRef<Set<string>>(new Set());
  const displayedRef = useRef<Set<string>>(new Set());
  const turnDoneRef = useRef(false);
  // Serialize emits so blocks reach `<Static>` in turn order even when their
  // pre-warm awaits resolve at different times.
  const emitChainRef = useRef<Promise<void>>(Promise.resolve());
  const liveTextSignatureRef = useRef<string>("");

  if (turn) {
    const liveText = visibleTextBlocks(turn.blocks, displayedRef.current);
    const signature = liveTextSignature(liveText, turn.id);
    if (signature !== liveTextSignatureRef.current) {
      liveTextSignatureRef.current = signature;
      queueMicrotask(() => onLiveTextChange?.(liveText, turn.id));
    }

    for (const b of turn.blocks) {
      if (isBlockFinal(b) && !emittedRef.current.has(b.id)) {
        emittedRef.current.add(b.id);
        const block = b;
        const turnId = turn.id;
        emitChainRef.current = emitChainRef.current.then(async () => {
          await ensureBlockHighlighted(block);
          onBlockFinalize(block, turnId);
          displayedRef.current.add(block.id);
          if (block.kind === "text") {
            const currentTurn = session.conversation.live ?? session.conversation.finalized.at(-1);
            const remaining = currentTurn
              ? visibleTextBlocks(currentTurn.blocks, displayedRef.current)
              : [];
            onLiveTextChange?.(remaining, turnId);
          }
        });
      }
    }
  }

  if (session.done && finalized && !turnDoneRef.current) {
    turnDoneRef.current = true;
    const turnId = finalized.id;
    emitChainRef.current = emitChainRef.current.then(() => {
      onLiveTextChange?.([], turnId);
      onTurnDone(turnId);
    });
  }
  if (session.error && !turnDoneRef.current) {
    turnDoneRef.current = true;
    const err = session.error;
    emitChainRef.current = emitChainRef.current.then(() => {
      onLiveTextChange?.([], 0);
      onError?.(err);
    });
  }

  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(
      Box,
      { key: "working" },
      createElement(Spinner, null),
      createElement(
        Box,
        { marginLeft: 1 },
        createElement(WorkingStats, { startedAt: startedAtRef.current, usage: turn?.usage }),
      ),
    ),
  );
}
