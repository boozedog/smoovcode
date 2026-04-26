import type { HostApprovalRequest } from "@smoovcode/agent";
import { type ApprovalQueue, type Turn } from "@smoovcode/ui-core";
import { type AgentLike, useApprovalQueue } from "@smoovcode/ui-react";
import { Box, Static, Text } from "ink";
import React from "react";
import { ApprovalModal } from "./approval-modal.tsx";
import { LiveTurn } from "./live-turn.tsx";
import { Prompt } from "./prompt.tsx";
import { TurnView } from "./turn-view.tsx";

export interface AppProps {
  agent: AgentLike;
  approvalQueue: ApprovalQueue<HostApprovalRequest>;
  banner: string;
}

interface PendingTurn {
  key: number;
  message: string;
}

type StaticItem =
  | { kind: "banner"; key: string; text: string }
  | { kind: "turn"; key: string; turn: Turn };

export function App({ agent, approvalQueue, banner }: AppProps): React.ReactElement {
  const [finalized, setFinalized] = React.useState<Turn[]>([]);
  const [pending, setPending] = React.useState<PendingTurn | null>(null);
  const [keyCounter, setKeyCounter] = React.useState(0);
  // Subscribe so the App re-renders when the approval queue head changes.
  const { pending: approval } = useApprovalQueue(approvalQueue);

  const submit = (message: string) => {
    setPending({ key: keyCounter, message });
    setKeyCounter((k) => k + 1);
  };

  const handleDone = (turn: Turn) => {
    setFinalized((prev) => [...prev, turn]);
    setPending(null);
  };

  const handleError = (err: unknown) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    setFinalized((prev) => [
      ...prev,
      {
        id: prev.length,
        userMessage: pending?.message ?? "",
        text: "",
        reasoning: "",
        toolCalls: [],
        errors: [errMsg],
        status: "done",
      },
    ]);
    setPending(null);
  };

  const staticItems: StaticItem[] = [
    { kind: "banner", key: "banner", text: banner },
    ...finalized.map<StaticItem>((t) => ({ kind: "turn", key: `t-${t.id}`, turn: t })),
  ];

  const renderStaticItem = (item: StaticItem) =>
    item.kind === "banner"
      ? React.createElement(Text, { key: item.key, dimColor: true }, item.text)
      : React.createElement(
          Box,
          { key: item.key, marginTop: 1 },
          React.createElement(TurnView, { turn: item.turn }),
        );

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Static, {
      items: staticItems,
      children: renderStaticItem as (item: unknown, index: number) => React.ReactNode,
    }),
    pending
      ? React.createElement(
          Box,
          { key: "live", marginTop: 1 },
          React.createElement(LiveTurn, {
            key: pending.key,
            agent,
            message: pending.message,
            onDone: handleDone,
            onError: handleError,
          }),
        )
      : null,
    !pending && approval === null
      ? React.createElement(
          Box,
          { key: "prompt", marginTop: 1 },
          React.createElement(Prompt, { onSubmit: submit }),
        )
      : null,
    approval !== null
      ? React.createElement(ApprovalModal, { key: "approval", queue: approvalQueue })
      : null,
  );
}
