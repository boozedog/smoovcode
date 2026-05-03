import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Box, Text } from "ink";
import React from "react";

export interface SessionStats {
  cwd?: string;
  branch?: string;
  inputTokens?: number;
  outputTokens?: number;
  contextPercent?: number;
  contextWindow?: number;
  costUsd?: number;
  subscription?: boolean;
  model?: string;
  effort?: string;
}

function formatCompactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatCwd(cwd: string): string {
  const home = os.homedir();
  return cwd === home || cwd.startsWith(`${home}${path.sep}`) ? `~${cwd.slice(home.length)}` : cwd;
}

export function readGitBranch(cwd: string): string | undefined {
  try {
    return (
      execFileSync("git", ["branch", "--show-current"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export function formatStatusLine(stats: SessionStats = {}): string {
  const cwd = formatCwd(stats.cwd ?? process.cwd());
  const branch = stats.branch ?? readGitBranch(stats.cwd ?? process.cwd());
  const parts = [`${cwd}${branch ? ` (${branch})` : ""}`];
  parts.push(`↑${formatCompactNumber(stats.inputTokens ?? 0)}`);
  parts.push(`↓${formatCompactNumber(stats.outputTokens ?? 0)}`);
  if (stats.costUsd !== undefined) parts.push(`$${stats.costUsd.toFixed(3)}`);
  if (stats.subscription) parts.push("(sub)");
  if (stats.contextPercent !== undefined && stats.contextWindow !== undefined) {
    parts.push(`${stats.contextPercent.toFixed(1)}%/${formatCompactNumber(stats.contextWindow)}`);
  } else if (stats.contextWindow !== undefined) {
    parts.push(`${formatCompactNumber(stats.contextWindow)} ctx`);
  }
  parts.push(stats.model ?? process.env.SMOOV_MODEL ?? "gpt-5");
  if (stats.effort) parts.push(`• ${stats.effort}`);
  return parts.join(" ");
}

export function StatusLine({ stats }: { stats?: SessionStats }): React.ReactElement {
  return React.createElement(
    Box,
    { borderStyle: "single", borderColor: "gray", paddingX: 1 },
    React.createElement(Text, { dimColor: true }, formatStatusLine(stats)),
  );
}
