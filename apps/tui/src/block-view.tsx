import type { Block, ToolCallBlock } from "@smoovcode/ui-core";
import { Box, Text } from "ink";
import React from "react";
import { HighlightedCode, type Lang } from "./highlighted-code.tsx";
import { Spinner } from "./spinner.tsx";

interface BlockViewProps {
  block: Block;
  /** Render completed codemode blocks expanded instead of as a compact summary. */
  expandedCodemode?: boolean;
}

export function BlockView({ block, expandedCodemode = false }: BlockViewProps): React.ReactElement {
  switch (block.kind) {
    case "text":
      return React.createElement(HighlightedCode, { code: block.text, lang: "md" });
    case "reasoning":
      return React.createElement(Text, { dimColor: true }, `thinking: ${block.text}`);
    case "tool-call":
      return React.createElement(ToolCallView, { block, expandedCodemode });
    case "error":
      return React.createElement(Text, { color: "red" }, `[error] ${block.error}`);
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
}): React.ReactElement {
  if (block.name === "codemode" && isCodemodeInput(block.input)) {
    return React.createElement(CodemodeView, {
      block,
      input: block.input,
      expanded: expandedCodemode,
    });
  }
  if (block.name === "write" && isWriteInput(block.input)) {
    return React.createElement(WriteView, { block, input: block.input });
  }
  if (block.name === "edit" && isEditInput(block.input)) {
    return React.createElement(EditView, { block, input: block.input });
  }

  // Default: single-line rendering, with a leading spinner while running.
  const head = `[${block.name}] ${JSON.stringify(block.input)}`;
  let tail = "";
  if (block.status === "done") {
    tail = ` → ${JSON.stringify(extractResult(block.output))}`;
  } else if (block.status === "error") {
    tail = ` ✗ ${block.error}`;
  }
  if (block.status === "running") {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, head),
      React.createElement(Box, { marginLeft: 1 }, React.createElement(Spinner, null)),
    );
  }
  return React.createElement(Text, null, head + tail);
}

function CodemodeView({
  block,
  input,
  expanded,
}: {
  block: ToolCallBlock;
  input: { code: string };
  expanded: boolean;
}): React.ReactElement {
  const lineCount = input.code === "" ? 0 : input.code.split("\n").length;
  const lineLabel = `${lineCount} line${lineCount === 1 ? "" : "s"}`;
  const glyph = expanded || block.status === "running" ? "▼" : "▶";
  const result = extractResult(block.output);
  const resultSummary = block.status === "done" ? formatCollapsedResult(result) : "";
  const statusSummary = block.status === "error" ? ` ✗ ${block.error}` : resultSummary;

  if (!expanded && block.status !== "running") {
    return React.createElement(
      Text,
      null,
      React.createElement(Text, { color: "magenta" }, `${glyph} [${block.name}]`),
      React.createElement(Text, { dimColor: true }, ` ${lineLabel} · Ctrl+O to expand`),
      statusSummary,
    );
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "magenta" }, `${glyph} [${block.name}]`),
      React.createElement(
        Box,
        { marginLeft: 1 },
        React.createElement(Text, { dimColor: true }, `${lineLabel} · Ctrl+O to collapse`),
      ),
      block.status === "running"
        ? React.createElement(Box, { marginLeft: 1 }, React.createElement(Spinner, null))
        : null,
    ),
    React.createElement(HighlightedCode, { code: input.code, lang: "ts" }),
    block.status === "done"
      ? React.createElement(HighlightedCode, {
          code: formatCodemodeResult(block.output),
          lang: "json",
        })
      : null,
    block.status === "error"
      ? React.createElement(Text, { color: "red" }, `✗ ${block.error}`)
      : null,
  );
}

function WriteView({
  block,
  input,
}: {
  block: ToolCallBlock;
  input: { path: string; content: string };
}): React.ReactElement {
  const lang = inferLangFromPath(input.path);
  const bytes = extractBytes(block.output);
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "magenta" }, `[${block.name}]`),
      React.createElement(
        Box,
        { marginLeft: 1 },
        React.createElement(Text, { color: "cyan" }, input.path),
      ),
      block.status === "running"
        ? React.createElement(Box, { marginLeft: 1 }, React.createElement(Spinner, null))
        : null,
    ),
    lang
      ? React.createElement(HighlightedCode, { code: input.content, lang })
      : React.createElement(Text, null, input.content),
    block.status === "done" && bytes !== null
      ? React.createElement(Text, { dimColor: true }, `→ wrote ${bytes} bytes`)
      : null,
    block.status === "error"
      ? React.createElement(Text, { color: "red" }, `✗ ${block.error}`)
      : null,
  );
}

function EditView({
  block,
  input,
}: {
  block: ToolCallBlock;
  input: { path: string; oldString: string; newString: string };
}): React.ReactElement {
  const oldDiff = input.oldString
    .split("\n")
    .map((l) => `- ${l}`)
    .join("\n");
  const newDiff = input.newString
    .split("\n")
    .map((l) => `+ ${l}`)
    .join("\n");
  const replacements = extractReplacements(block.output);
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "magenta" }, `[${block.name}]`),
      React.createElement(
        Box,
        { marginLeft: 1 },
        React.createElement(Text, { color: "cyan" }, input.path),
      ),
      block.status === "running"
        ? React.createElement(Box, { marginLeft: 1 }, React.createElement(Spinner, null))
        : null,
    ),
    React.createElement(Text, { color: "red" }, oldDiff),
    React.createElement(Text, { color: "green" }, newDiff),
    block.status === "done" && replacements !== null
      ? React.createElement(
          Text,
          { dimColor: true },
          `→ ${replacements} replacement${replacements === 1 ? "" : "s"}`,
        )
      : null,
    block.status === "error"
      ? React.createElement(Text, { color: "red" }, `✗ ${block.error}`)
      : null,
  );
}

function formatCollapsedResult(result: unknown): string {
  if (result === undefined) return " ✓ done";
  if (typeof result === "string") return ` → string (${result.length} chars)`;
  if (Array.isArray(result)) return ` → array (${result.length} items)`;
  if (result && typeof result === "object") {
    const keys = Object.keys(result);
    return ` → object (${keys.length} key${keys.length === 1 ? "" : "s"})`;
  }
  return ` → ${JSON.stringify(result)}`;
}

function extractResult(o: unknown): unknown {
  return o && typeof o === "object" && "result" in o ? (o as { result: unknown }).result : o;
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
