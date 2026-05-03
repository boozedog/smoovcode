import type { Mode } from "@smoovcode/agent";
import { type Block, type ToolCallBlock } from "@smoovcode/ui-core";
import { type AgentLike, useAgentSession } from "@smoovcode/ui-react";
import { Box, Text } from "ink";
import React from "react";
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
  /** Operating mode for this turn — `edit` (default), `plan`, or `auto`. */
  mode?: Mode;
  /**
   * Called once per block as it transitions out of streaming/running into a
   * terminal state. App promotes the block into `<Static>` scrollback.
   */
  onBlockFinalize: (block: Block, turnId: number) => void;
  /** Called once when the turn-end event has finalized all blocks. */
  onTurnDone: (turnId: number) => void;
  onError?: (err: unknown) => void;
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
 * number of lines so it can never exceed terminal height: a single "thinking"
 * spinner line plus one indented spinner-prefixed line per currently-running
 * tool-call. Streaming text/reasoning are not rendered live — they emit to
 * `<Static>` once finalized via `onBlockFinalize`. (If you want to watch the
 * model think token-by-token, use the CLI.)
 */
export function LiveTurn({
  agent,
  message,
  mode,
  onBlockFinalize,
  onTurnDone,
  onError,
}: LiveTurnProps): React.ReactElement | null {
  const session = useAgentSession({
    agent,
    message,
    ...(mode !== undefined ? { mode } : {}),
  });
  const live = session.conversation.live;
  const finalized = session.conversation.finalized.at(-1);
  const turn = live ?? finalized;

  const emittedRef = React.useRef<Set<string>>(new Set());
  const turnDoneRef = React.useRef(false);
  // Serialize emits so blocks reach `<Static>` in turn order even when their
  // pre-warm awaits resolve at different times.
  const emitChainRef = React.useRef<Promise<void>>(Promise.resolve());

  if (turn) {
    for (const b of turn.blocks) {
      if (isBlockFinal(b) && !emittedRef.current.has(b.id)) {
        emittedRef.current.add(b.id);
        const block = b;
        const turnId = turn.id;
        emitChainRef.current = emitChainRef.current.then(async () => {
          await ensureBlockHighlighted(block);
          onBlockFinalize(block, turnId);
        });
      }
    }
  }

  if (session.done && finalized && !turnDoneRef.current) {
    turnDoneRef.current = true;
    const turnId = finalized.id;
    emitChainRef.current = emitChainRef.current.then(() => {
      onTurnDone(turnId);
    });
  }
  if (session.error && !turnDoneRef.current) {
    turnDoneRef.current = true;
    const err = session.error;
    emitChainRef.current = emitChainRef.current.then(() => {
      onError?.(err);
    });
  }

  if (session.done || session.error) return null;

  const runningToolCalls: ToolCallBlock[] = turn
    ? turn.blocks.filter(
        (b): b is ToolCallBlock => b.kind === "tool-call" && b.status === "running",
      )
    : [];

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      { key: "thinking" },
      React.createElement(Spinner, null),
      React.createElement(
        Box,
        { marginLeft: 1 },
        React.createElement(Text, { dimColor: true }, "thinking"),
      ),
    ),
    ...runningToolCalls.map((b) =>
      React.createElement(
        Box,
        { key: b.id, marginLeft: 2 },
        React.createElement(Spinner, null),
        React.createElement(Box, { marginLeft: 1 }, React.createElement(Text, null, `[${b.name}]`)),
      ),
    ),
  );
}
