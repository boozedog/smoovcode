import type { Block, ToolCallBlock } from "@smoovcode/ui-core";
import { Box, Text } from "ink";
import { createElement, type ReactElement } from "react";
import { HighlightedCode, type Lang } from "./highlighted-code.tsx";

interface BlockViewProps {
  block: Block;
  /** Render completed codemode blocks expanded instead of as a compact summary. */
  expandedCodemode?: boolean;
}

export function BlockView({ block, expandedCodemode = false }: BlockViewProps): ReactElement {
  switch (block.kind) {
    case "text":
      return createElement(HighlightedCode, { code: block.text, lang: "md" });
    case "reasoning":
      return createElement(Text, { dimColor: true }, `thinking: ${block.text}`);
    case "tool-call":
      return createElement(ToolCallView, { block, expandedCodemode });
    case "error":
      return createElement(Text, { color: "red" }, `[error] ${block.error}`);
  }
}

export function isCodemodeInput(x: unknown): x is { code: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "code" in x &&
    typeof (x as { code: unknown }).code === "string"
  );
}

export function isWriteInput(x: unknown): x is { path: string; content: string } {
  if (typeof x !== "object" || x === null) return false;
  const o = x as { path?: unknown; content?: unknown };
  return typeof o.path === "string" && typeof o.content === "string";
}

export function isEditInput(
  x: unknown,
): x is { path: string; oldString: string; newString: string } {
  if (typeof x !== "object" || x === null) return false;
  const o = x as { path?: unknown; oldString?: unknown; newString?: unknown };
  return (
    typeof o.path === "string" && typeof o.oldString === "string" && typeof o.newString === "string"
  );
}

export function formatCodemodeResult(output: unknown): string {
  return `→ ${JSON.stringify(extractResult(output), null, 2)}`;
}

/**
 * Pick a syntax-highlight language from a file extension, or `null` when we
 * don't have a loader for it (caller falls back to plain text).
 */
export function inferLangFromPath(path: string): Lang | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "ts" || ext === "tsx") return "ts";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "js";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "mdx") return "md";
  if (ext === "go") return "go";
  return null;
}

function ToolCallView({
  block,
  expandedCodemode,
}: {
  block: ToolCallBlock;
  expandedCodemode: boolean;
}): ReactElement {
  if (block.name === "codemode" && isCodemodeInput(block.input)) {
    return createElement(CodemodeView, {
      block,
      input: block.input,
      expanded: expandedCodemode,
    });
  }
  if (block.name === "write" && isWriteInput(block.input)) {
    return createElement(WriteView, { block, input: block.input });
  }
  if (block.name === "edit" && isEditInput(block.input)) {
    return createElement(EditView, { block, input: block.input });
  }

  // Default: single-line rendering. Transcript rendering must stay static; live
  // animation belongs in the fixed bottom pane.
  const head = `[${block.name}] ${JSON.stringify(block.input)}`;
  let tail = "";
  if (block.status === "done") {
    tail = ` → ${JSON.stringify(extractResult(block.output))}`;
  } else if (block.status === "error") {
    tail = ` ✗ ${block.error}`;
  }
  if (block.status === "running") {
    return createElement(
      Box,
      null,
      createElement(Text, null, head),
      createElement(Box, { marginLeft: 1 }, createElement(Text, { color: "cyan" }, "⠋")),
    );
  }
  return createElement(Text, null, head + tail);
}

function CodemodeView({
  block,
  input,
  expanded,
}: {
  block: ToolCallBlock;
  input: { code: string };
  expanded: boolean;
}): ReactElement {
  const lineCount = input.code === "" ? 0 : input.code.split("\n").length;
  const lineLabel = `${lineCount} line${lineCount === 1 ? "" : "s"}`;
  const glyph = expanded || block.status === "running" ? "▼" : "▶";
  const result = extractResult(block.output);
  const metrics = extractMetrics(block.output);
  const metadata = [lineLabel];
  if (metrics) {
    metadata.push(`${metrics.toolCalls} call${metrics.toolCalls === 1 ? "" : "s"}`);
  }
  metadata.push(`${formatBytes(byteLength(input.code))} in`);
  if (block.status === "done") metadata.push(`${formatBytes(byteLength(block.output))} out`);
  const resultSummary = block.status === "done" && result === undefined ? " ✓ done" : "";
  const statusSummary = block.status === "error" ? ` ✗ ${block.error}` : resultSummary;

  if (!expanded && block.status !== "running") {
    return createElement(
      Text,
      null,
      createElement(Text, { color: "magenta" }, `${glyph} [${block.name}]`),
      createElement(Text, { dimColor: true }, ` ${metadata.join(" · ")}`),
      statusSummary,
    );
  }

  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(
      Box,
      null,
      createElement(Text, { color: "magenta" }, `${glyph} [${block.name}]`),
      createElement(
        Box,
        { marginLeft: 1 },
        createElement(Text, { dimColor: true }, metadata.join(" · ")),
      ),
      block.status === "running"
        ? createElement(Box, { marginLeft: 1 }, createElement(Text, { color: "cyan" }, "⠋"))
        : null,
    ),
    createElement(HighlightedCode, { code: input.code, lang: "ts" }),
    block.status === "done"
      ? createElement(HighlightedCode, {
          code: formatCodemodeResult(block.output),
          lang: "json",
        })
      : null,
    block.status === "error" ? createElement(Text, { color: "red" }, `✗ ${block.error}`) : null,
  );
}

function WriteView({
  block,
  input,
}: {
  block: ToolCallBlock;
  input: { path: string; content: string };
}): ReactElement {
  const lang = inferLangFromPath(input.path);
  const bytes = extractBytes(block.output);
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(
      Box,
      null,
      createElement(Text, { color: "magenta" }, `[${block.name}]`),
      createElement(Box, { marginLeft: 1 }, createElement(Text, { color: "cyan" }, input.path)),
      block.status === "running"
        ? createElement(Box, { marginLeft: 1 }, createElement(Text, { color: "cyan" }, "⠋"))
        : null,
    ),
    lang
      ? createElement(HighlightedCode, { code: input.content, lang })
      : createElement(Text, null, input.content),
    block.status === "done" && bytes !== null
      ? createElement(Text, { dimColor: true }, `→ wrote ${bytes} bytes`)
      : null,
    block.status === "error" ? createElement(Text, { color: "red" }, `✗ ${block.error}`) : null,
  );
}

function EditView({
  block,
  input,
}: {
  block: ToolCallBlock;
  input: { path: string; oldString: string; newString: string };
}): ReactElement {
  const oldDiff = input.oldString
    .split("\n")
    .map((l) => `- ${l}`)
    .join("\n");
  const newDiff = input.newString
    .split("\n")
    .map((l) => `+ ${l}`)
    .join("\n");
  const replacements = extractReplacements(block.output);
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(
      Box,
      null,
      createElement(Text, { color: "magenta" }, `[${block.name}]`),
      createElement(Box, { marginLeft: 1 }, createElement(Text, { color: "cyan" }, input.path)),
      block.status === "running"
        ? createElement(Box, { marginLeft: 1 }, createElement(Text, { color: "cyan" }, "⠋"))
        : null,
    ),
    createElement(Text, { color: "red" }, oldDiff),
    createElement(Text, { color: "green" }, newDiff),
    block.status === "done" && replacements !== null
      ? createElement(
          Text,
          { dimColor: true },
          `→ ${replacements} replacement${replacements === 1 ? "" : "s"}`,
        )
      : null,
    block.status === "error" ? createElement(Text, { color: "red" }, `✗ ${block.error}`) : null,
  );
}

function byteLength(value: unknown): number {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.byteLength(serialized ?? "", "utf8");
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1).replace(/\.0$/, "")} kB`;
  return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
}

function extractResult(o: unknown): unknown {
  return o && typeof o === "object" && "result" in o ? (o as { result: unknown }).result : o;
}

function extractMetrics(o: unknown): { toolCalls: number } | null {
  if (o && typeof o === "object" && "metrics" in o) {
    const metrics = (o as { metrics: unknown }).metrics;
    if (metrics && typeof metrics === "object" && "toolCalls" in metrics) {
      const toolCalls = (metrics as { toolCalls: unknown }).toolCalls;
      if (typeof toolCalls === "number") return { toolCalls };
    }
  }
  return null;
}

function extractBytes(o: unknown): number | null {
  if (o && typeof o === "object" && "bytes" in o) {
    const b = (o as { bytes: unknown }).bytes;
    if (typeof b === "number") return b;
  }
  return null;
}

function extractReplacements(o: unknown): number | null {
  if (o && typeof o === "object" && "replacements" in o) {
    const r = (o as { replacements: unknown }).replacements;
    if (typeof r === "number") return r;
  }
  return null;
}
