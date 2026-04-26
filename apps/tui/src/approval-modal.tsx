import type { ApprovalQueue } from "@smoovcode/ui-core";
import { useApprovalQueue } from "@smoovcode/ui-react";
import { Box, Text, useInput } from "ink";
import React from "react";

interface ApprovalModalProps {
  queue: ApprovalQueue<{ argv: readonly string[]; reason?: string }>;
}

/**
 * Mounted only when the queue has a pending request (parent gates this on
 * `queue.peek()`). Renders the head request and resolves on `y`/`n` keypress.
 */
export function ApprovalModal({ queue }: ApprovalModalProps): React.ReactElement | null {
  const { pending, resolve } = useApprovalQueue(queue);

  useInput((input) => {
    if (!pending) return;
    if (input === "y" || input === "Y") resolve(true);
    else if (input === "n" || input === "N") resolve(false);
  });

  if (!pending) return null;

  const display = pending.argv
    .map((a) => (/[^A-Za-z0-9_./-]/.test(a) ? JSON.stringify(a) : a))
    .join(" ");

  return React.createElement(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1 },
    React.createElement(Text, { color: "yellow" }, "host execution requested:"),
    React.createElement(Text, null, display),
    pending.reason
      ? React.createElement(Text, { dimColor: true }, `reason: ${pending.reason}`)
      : null,
    React.createElement(Text, null, "approve? [y/N]"),
  );
}
