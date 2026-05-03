import { type HostApprovalRequest, type Mode, nextMode } from "@smoovcode/agent";
import { type ApprovalQueue, type Block } from "@smoovcode/ui-core";
import { type AgentLike, useApprovalQueue } from "@smoovcode/ui-react";
import { Box, Text, useApp, useInput } from "ink";
import React from "react";
import { ApprovalModal } from "./approval-modal.tsx";
import { BlockView } from "./block-view.tsx";
import { LiveTurn } from "./live-turn.tsx";
import { Prompt } from "./prompt.tsx";

export interface AppProps {
  agent: AgentLike;
  approvalQueue: ApprovalQueue<HostApprovalRequest>;
  banner: string;
}

interface PendingTurn {
  key: number;
  message: string;
  mode: Mode;
}

type StaticItem =
  | { kind: "banner"; key: string; text: string }
  | { kind: "user"; key: string; userMessage: string }
  | { kind: "block"; key: string; block: Block };

export function App({ agent, approvalQueue, banner }: AppProps): React.ReactElement {
  const [staticItems, setStaticItems] = React.useState<StaticItem[]>([
    { kind: "banner", key: "banner", text: banner },
  ]);
  const [pending, setPending] = React.useState<PendingTurn | null>(null);
  const [keyCounter, setKeyCounter] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>("edit");
  const [expandedCodemode, setExpandedCodemode] = React.useState(false);
  const { pending: approval } = useApprovalQueue(approvalQueue);
  const { exit } = useApp();

  useInput((input, key) => {
    if ((key.ctrl && input === "c") || input === "\u0003") exit();
    if (key.ctrl && input === "o") setExpandedCodemode((expanded) => !expanded);
  });

  const submit = (message: string) => {
    setStaticItems((prev) => [
      ...prev,
      { kind: "user", key: `u-${keyCounter}`, userMessage: message },
    ]);
    setPending({ key: keyCounter, message, mode });
    setKeyCounter((k) => k + 1);
  };

  const cycleMode = () => {
    setMode((m) => nextMode(m));
  };

  const handleBlockFinalize = (block: Block, turnId: number) => {
    setStaticItems((prev) => [...prev, { kind: "block", key: `b-${turnId}-${block.id}`, block }]);
  };

  const handleTurnDone = () => {
    setPending(null);
  };

  const handleError = (err: unknown) => {
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

  const renderStaticItem = (item: StaticItem) => {
    if (item.kind === "banner") {
      return React.createElement(Text, { key: item.key, dimColor: true }, item.text);
    }
    if (item.kind === "user") {
      return React.createElement(
        Box,
        { key: item.key, marginTop: 1 },
        React.createElement(Text, { color: "cyan" }, `> ${item.userMessage}`),
      );
    }
    return React.createElement(
      Box,
      { key: item.key },
      React.createElement(BlockView, { block: item.block, expandedCodemode }),
    );
  };

  return React.createElement(
    Box,
    { flexDirection: "column" },
    ...staticItems.map(renderStaticItem),
    pending
      ? React.createElement(
          Box,
          { key: "live", flexDirection: "column" },
          React.createElement(LiveTurn, {
            key: pending.key,
            agent,
            message: pending.message,
            mode: pending.mode,
            onBlockFinalize: handleBlockFinalize,
            onTurnDone: handleTurnDone,
            onError: handleError,
          }),
        )
      : null,
    !pending && approval === null
      ? React.createElement(
          Box,
          { key: "prompt", marginTop: 1 },
          React.createElement(Prompt, { onSubmit: submit, mode, onCycleMode: cycleMode }),
        )
      : null,
    approval !== null
      ? React.createElement(ApprovalModal, { key: "approval", queue: approvalQueue })
      : null,
  );
}
