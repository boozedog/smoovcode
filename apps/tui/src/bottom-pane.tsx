import { Box } from "ink";
import { createElement, type ReactElement, type ReactNode } from "react";
import { type SessionStats, StatusLine } from "./status-line.tsx";

export interface BottomPaneProps {
  children?: ReactNode;
  stats?: SessionStats;
}

export function BottomPane({ children, stats }: BottomPaneProps): ReactElement {
  return createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    children,
    createElement(StatusLine, { stats }),
  );
}
