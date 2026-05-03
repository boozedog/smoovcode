import { Box } from "ink";
import React from "react";
import { type SessionStats, StatusLine } from "./status-line.tsx";

export interface BottomPaneProps {
  children?: React.ReactNode;
  stats?: SessionStats;
}

export function BottomPane({ children, stats }: BottomPaneProps): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    children,
    React.createElement(StatusLine, { stats }),
  );
}
