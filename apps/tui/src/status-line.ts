import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { ansi } from "./ansi.ts";

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
  if (Math.abs(n) >= 1_000) {
    const thousands = n / 1_000;
    return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
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

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5": 400_000,
  "gpt-5-mini": 400_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
};

export function shortModelName(model: string): string {
  const parts = model.split("/").filter(Boolean);
  return parts.at(-1) ?? model;
}

export function contextWindowForModel(model: string): number | undefined {
  const shortName = shortModelName(model);
  if (MODEL_CONTEXT_WINDOWS[shortName] !== undefined) return MODEL_CONTEXT_WINDOWS[shortName];
  if (shortName.startsWith("gpt-5")) return MODEL_CONTEXT_WINDOWS["gpt-5"];
  if (shortName.startsWith("gpt-4o")) return MODEL_CONTEXT_WINDOWS["gpt-4o"];
  return undefined;
}

function formatModelLabel(stats: SessionStats): string {
  return shortModelName(stats.model ?? process.env.SMOOV_MODEL ?? "gpt-5");
}

function formatTokenStats(stats: SessionStats): string | undefined {
  if (stats.inputTokens === undefined && stats.outputTokens === undefined) return undefined;
  return `↑${formatCompactNumber(stats.inputTokens ?? 0)} ↓${formatCompactNumber(stats.outputTokens ?? 0)}`;
}

function formatContextStats(stats: SessionStats): string | undefined {
  if (stats.contextWindow === undefined) return undefined;
  const usedTokens = stats.inputTokens ?? 0;
  const usedPercent = Math.min(
    100,
    Math.max(0, Math.round((usedTokens / stats.contextWindow) * 100)),
  );
  const availablePercent = Math.max(0, 100 - usedPercent);
  return `${usedPercent}% used/${availablePercent}% avail/${formatCompactNumber(stats.contextWindow)} ctx`;
}

export function formatStatusLine(stats: SessionStats = {}): string {
  const project = formatProject(stats.cwd ?? process.cwd());
  const branch = stats.branch ?? readGitBranch(stats.cwd ?? process.cwd());
  const detailParts = [ansi.cyan(`[${formatModelLabel(stats)}]`)];
  const revision = stats.revision ?? readGitRevision(stats.cwd ?? process.cwd());
  if (revision) detailParts.push(ansi.dim(` ${revision}`));
  const tokenStats = formatTokenStats(stats);
  if (tokenStats) detailParts.push(` ${tokenStats}`);
  const contextStats = formatContextStats(stats);
  if (contextStats) detailParts.push(ansi.green(` ${contextStats}`));
  if (stats.effort) detailParts.push(ansi.dim(` • ${stats.effort}`));
  const projectLine = branch
    ? `${ansi.blue(project)}${ansi.magenta(" on ")}${ansi.bold(ansi.magenta(branch))}`
    : ansi.blue(project);
  return [projectLine, detailParts.join("")].join("\n");
}
