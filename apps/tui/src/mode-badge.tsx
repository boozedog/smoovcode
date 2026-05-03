import type { Mode } from "@smoovcode/agent";
import { Text } from "ink";
import React from "react";

const MODE_COLORS: Record<Mode, string> = {
  edit: "green",
  plan: "yellow",
  auto: "magenta",
};

/**
 * Single-line mode indicator. Renders as `[plan]`, `[edit]`, or `[auto]` in a
 * mode-specific accent color. Theme-token plumbing arrives with #5.
 */
export function ModeBadge({ mode }: { mode: Mode }): React.ReactElement {
  return React.createElement(Text, { color: MODE_COLORS[mode], bold: true }, `[${mode}]`);
}
