import { type HostApprovalRequest } from "@smoovcode/agent";
import { type ApprovalQueue, type Block } from "@smoovcode/ui-core";
import { type AgentLike, useApprovalQueue, useMountEffect } from "@smoovcode/ui-react";
import {
  Box,
  Text,
  useApp,
  useBoxMetrics,
  useInput,
  useStdin,
  useStdout,
  type DOMElement,
} from "ink";
import React from "react";
import { ApprovalModal } from "./approval-modal.tsx";
import { BlockView } from "./block-view.tsx";
import { BottomPane } from "./bottom-pane.tsx";
import { LiveTurn } from "./live-turn.tsx";
import type { SessionStats } from "./status-line.tsx";
import { Prompt } from "./prompt.tsx";

export interface AppProps {
  agent: AgentLike;
  approvalQueue: ApprovalQueue<HostApprovalRequest>;
  banner: string;
  stats?: SessionStats;
}

interface PendingTurn {
  key: number;
  message: string;
}

type StaticItem =
  | { kind: "banner"; key: string; text: string }
  | { kind: "user"; key: string; userMessage: string }
  | { kind: "block"; key: string; block: Block };

const ESC = String.fromCharCode(27);
const SGR_MOUSE_RE = new RegExp(`${ESC}\\[<(\\d+);(\\d+);(\\d+)([mM])`, "g");

function TranscriptItem({
  item,
  expandedCodemode,
  metricsRef,
}: {
  item: StaticItem;
  expandedCodemode: boolean;
  metricsRef: React.RefObject<Map<string, { top: number; height: number }>>;
}): React.ReactElement {
  const ref = React.useRef<DOMElement>(null) as React.RefObject<DOMElement>;
  const metrics = useBoxMetrics(ref);
  if (metrics.hasMeasured) {
    metricsRef.current.set(item.key, { top: metrics.top, height: metrics.height });
  }

  if (item.kind === "banner") {
    return React.createElement(
      Box,
      { key: item.key, ref },
      React.createElement(Text, { dimColor: true }, item.text),
    );
  }
  if (item.kind === "user") {
    return React.createElement(
      Box,
      { key: item.key, ref, marginTop: 1 },
      React.createElement(Text, { color: "cyan" }, `> ${item.userMessage}`),
    );
  }
  return React.createElement(
    Box,
    { key: item.key, ref },
    React.createElement(BlockView, { block: item.block, expandedCodemode }),
  );
}

export function App({ agent, approvalQueue, banner, stats }: AppProps): React.ReactElement {
  const [staticItems, setStaticItems] = React.useState<StaticItem[]>([
    { kind: "banner", key: "banner", text: banner },
  ]);
  const [pending, setPending] = React.useState<PendingTurn | null>(null);
  const [liveTextItems, setLiveTextItems] = React.useState<StaticItem[]>([]);
  const [keyCounter, setKeyCounter] = React.useState(0);
  const [discardPrompt, setDiscardPrompt] = React.useState(false);
  const [expandedCodemodeIds, setExpandedCodemodeIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [scrollbackLines, setScrollbackLines] = React.useState(0);
  const transcriptContentRef = React.useRef<DOMElement>(null) as React.RefObject<DOMElement>;
  const { pending: approval } = useApprovalQueue(approvalQueue);
  const { exit } = useApp();
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const rows = stdout.rows ?? 24;
  const statusRows = 2;
  const bottomPaneMarginRows = 1;
  const promptRows = !pending && approval === null && !discardPrompt ? 2 : 0;
  const liveTurnRows = pending ? 1 : 0;
  const approvalRows = approval ? 6 : 0;
  const discardRows = discardPrompt ? 2 : 0;
  const reservedRows =
    statusRows + bottomPaneMarginRows + promptRows + liveTurnRows + approvalRows + discardRows;
  const transcriptHeight = Math.max(1, rows - reservedRows);
  const transcriptContent = useBoxMetrics(transcriptContentRef);
  const maxScrollLines = Math.max(0, transcriptContent.height - transcriptHeight);
  const clampedScrollbackLines = Math.min(scrollbackLines, maxScrollLines);
  const transcriptOffset = -Math.max(0, maxScrollLines - clampedScrollbackLines);
  const itemMetricsRef = React.useRef(new Map<string, { top: number; height: number }>());
  const transcriptItems = [...staticItems, ...liveTextItems];
  const latestRef = React.useRef({
    transcriptItems,
    transcriptHeight,
    maxScrollLines,
    transcriptOffset,
  });
  latestRef.current = { transcriptItems, transcriptHeight, maxScrollLines, transcriptOffset };

  const hasDirtySession = (): boolean => {
    const maybeAgent = agent as { session?: { dirty?: { isDirty?: () => boolean } } };
    return maybeAgent.session?.dirty?.isDirty?.() === true;
  };

  useInput((input, key) => {
    if (discardPrompt) {
      if (input.toLowerCase() === "y") exit();
      if (input.toLowerCase() === "n" || key.escape || key.return) setDiscardPrompt(false);
      return;
    }
    if ((key.ctrl && input === "c") || input === "\u0003") {
      if (hasDirtySession()) setDiscardPrompt(true);
      else exit();
      return;
    }
    if (key.ctrl && input === "o") {
      setExpandedCodemodeIds((prev) => {
        const codemodeIds = staticItems.flatMap((item) =>
          item.kind === "block" && item.block.kind === "tool-call" && item.block.name === "codemode"
            ? [item.key]
            : [],
        );
        return prev.size === codemodeIds.length ? new Set() : new Set(codemodeIds);
      });
    }
    if (key.pageUp) setScrollbackLines((n) => Math.min(maxScrollLines, n + transcriptHeight));
    if (key.pageDown) setScrollbackLines((n) => Math.max(0, n - transcriptHeight));
    if (key.upArrow && key.meta) setScrollbackLines((n) => Math.min(maxScrollLines, n + 1));
    if (key.downArrow && key.meta) setScrollbackLines((n) => Math.max(0, n - 1));
  });

  useMountEffect(() => {
    if (!stdin.isTTY || !stdout.isTTY || process.env.NODE_ENV === "test") return;
    stdout.write("\u001B[?1000h\u001B[?1002h\u001B[?1006h");

    const onData = (chunk: Buffer | string) => {
      const mouseEvents = chunk.toString().matchAll(SGR_MOUSE_RE);
      for (const match of mouseEvents) {
        const button = Number(match[1]);
        const y = Number(match[3]);
        const {
          transcriptItems: latestItems,
          transcriptHeight: latestTranscriptHeight,
          maxScrollLines: latestMaxScrollLines,
          transcriptOffset: latestTranscriptOffset,
        } = latestRef.current;
        if (y > latestTranscriptHeight) continue;
        if (button === 64) {
          setScrollbackLines((n) => Math.min(latestMaxScrollLines, n + 3));
        } else if (button === 65) {
          setScrollbackLines((n) => Math.max(0, n - 3));
        } else if (button === 0 && match[4] === "M") {
          const contentY = y - 1 - latestTranscriptOffset;
          const item = latestItems.find((candidate) => {
            const metric = itemMetricsRef.current.get(candidate.key);
            return (
              metric !== undefined &&
              contentY >= metric.top &&
              contentY < metric.top + metric.height
            );
          });
          if (
            item?.kind === "block" &&
            item.block.kind === "tool-call" &&
            item.block.name === "codemode"
          ) {
            setExpandedCodemodeIds((prev) => {
              const next = new Set(prev);
              if (next.has(item.key)) next.delete(item.key);
              else next.add(item.key);
              return next;
            });
          }
        }
      }
    };

    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
      stdout.write("\u001B[?1000l\u001B[?1002l\u001B[?1006l");
    };
  });

  const submit = (message: string) => {
    setScrollbackLines(0);
    setLiveTextItems([]);
    setStaticItems((prev) => [
      ...prev,
      { kind: "user", key: `u-${keyCounter}`, userMessage: message },
    ]);
    setPending({ key: keyCounter, message });
    setKeyCounter((k) => k + 1);
  };

  const handleBlockFinalize = (block: Block, turnId: number) => {
    setStaticItems((prev) => [...prev, { kind: "block", key: `b-${turnId}-${block.id}`, block }]);
  };

  const handleLiveTextChange = (blocks: Block[], turnId: number) => {
    setLiveTextItems(
      blocks.map((block) => ({ kind: "block", key: `live-${turnId}-${block.id}`, block })),
    );
  };

  const handleTurnDone = () => {
    setLiveTextItems([]);
    setPending(null);
  };

  const handleError = (err: unknown) => {
    setLiveTextItems([]);
    const errMsg = err instanceof Error ? err.message : String(err);
    setStaticItems((prev) => [
      ...prev,
      {
        kind: "block",
        key: `err-${keyCounter}`,
        block: { kind: "error", id: `err-${keyCounter}`, error: errMsg, status: "done" },
      },
    ]);
    setPending(null);
  };

  return React.createElement(
    Box,
    { flexDirection: "column", height: rows, overflow: "hidden" },
    React.createElement(
      Box,
      { flexDirection: "column", height: transcriptHeight, overflowY: "hidden" },
      React.createElement(
        Box,
        {
          ref: transcriptContentRef,
          flexDirection: "column",
          flexShrink: 0,
          marginTop: transcriptOffset,
        },
        ...transcriptItems.map((item) =>
          React.createElement(TranscriptItem, {
            key: item.key,
            item,
            expandedCodemode: expandedCodemodeIds.has(item.key),
            metricsRef: itemMetricsRef,
          }),
        ),
      ),
    ),
    !pending && approval === null && !discardPrompt
      ? React.createElement(
          Box,
          { key: "prompt", marginTop: 1 },
          React.createElement(Prompt, { onSubmit: submit }),
        )
      : null,
    discardPrompt
      ? React.createElement(
          Box,
          { key: "discard", marginTop: 1 },
          React.createElement(
            Text,
            { color: "yellow" },
            "There are staged sandbox filesystem changes that have not been applied to disk. Exit and discard them? [y/N]",
          ),
        )
      : null,
    approval !== null
      ? React.createElement(ApprovalModal, { key: "approval", queue: approvalQueue })
      : null,
    React.createElement(
      BottomPane,
      { stats },
      pending
        ? React.createElement(LiveTurn, {
            key: pending.key,
            agent,
            message: pending.message,
            onBlockFinalize: handleBlockFinalize,
            onTurnDone: handleTurnDone,
            onLiveTextChange: handleLiveTextChange,
            onError: handleError,
          })
        : null,
    ),
  );
}
