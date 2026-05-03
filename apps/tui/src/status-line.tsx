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
  revision?: string;
}

function formatCompactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatProject(cwd: string): string {
  const home = os.homedir();
  const display =
    cwd === home || cwd.startsWith(`${home}${path.sep}`) ? `~${cwd.slice(home.length)}` : cwd;
  return path.basename(display) || display;
}

export function readGitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!branch) return undefined;
    const dirty =
      execFileSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0;
    return `${branch}${dirty ? "*" : ""}`;
  } catch {
    return undefined;
  }
}

export function readGitRevision(cwd: string): string | undefined {
  try {
    return (
      execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function formatModelLabel(stats: SessionStats): string {
  const model = stats.model ?? process.env.SMOOV_MODEL ?? "gpt-5";
  return stats.contextWindow !== undefined
    ? `${model} (${formatCompactNumber(stats.contextWindow)} context)`
    : model;
}

export function formatStatusLine(stats: SessionStats = {}): string {
  const project = formatProject(stats.cwd ?? process.cwd());
  const branch = stats.branch ?? readGitBranch(stats.cwd ?? process.cwd());
  const detailParts = [`[${formatModelLabel(stats)}]`];
  const revision = stats.revision ?? readGitRevision(stats.cwd ?? process.cwd());
  if (revision) detailParts.push(revision);
  if (stats.contextPercent !== undefined) detailParts.push(`${Math.round(stats.contextPercent)}%`);
  return [`${project}${branch ? ` on ${branch}` : ""}`, detailParts.join(" ")].join("\n");
}

export function StatusLine({ stats = {} }: { stats?: SessionStats }): React.ReactElement {
  const project = formatProject(stats.cwd ?? process.cwd());
  const branch = stats.branch ?? readGitBranch(stats.cwd ?? process.cwd());
  const modelLabel = formatModelLabel(stats);
  const revision = stats.revision ?? readGitRevision(stats.cwd ?? process.cwd());

  return React.createElement(
    Box,
    { flexDirection: "column", paddingX: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "blue" }, project),
      branch ? React.createElement(Text, { color: "magenta" }, ` on `) : null,
      branch ? React.createElement(Text, { color: "magenta", bold: true }, branch) : null,
    ),
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "cyan" }, `[${modelLabel}]`),
      revision ? React.createElement(Text, { dimColor: true }, ` ${revision}`) : null,
      stats.contextPercent !== undefined
        ? React.createElement(Text, { color: "green" }, ` ${Math.round(stats.contextPercent)}%`)
        : null,
    ),
  );
}
