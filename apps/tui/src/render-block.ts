import type { Block, ToolCallBlock } from "@smoovcode/ui-core";
import { ansi } from "./ansi.ts";
import { getHighlighted } from "./highlight-cache.ts";

export type Lang = "ts" | "js" | "json" | "md" | "go";

export function renderBlock(block: Block, opts: { expandedCodemode?: boolean } = {}): string[] {
  switch (block.kind) {
    case "text":
      return (getHighlighted(block.text, "md") ?? block.text).split("\n");
    case "reasoning":
      return [ansi.dim(`thinking: ${block.text}`)];
    case "tool-call":
      return renderToolCall(block, opts.expandedCodemode === true);
    case "error":
      return [ansi.red(`[error] ${block.error}`)];
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
  return `→ ${JSON.stringify(truncateLargeStrings(extractResult(output)), null, 2)}`;
}

export function inferLangFromPath(path: string): Lang | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "ts" || ext === "tsx") return "ts";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "js";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "mdx") return "md";
  if (ext === "go") return "go";
  return null;
}

function renderToolCall(block: ToolCallBlock, expandedCodemode: boolean): string[] {
  if (block.name === "codemode" && isCodemodeInput(block.input))
    return renderCodemode(block, block.input, expandedCodemode);
  if (block.name === "write" && isWriteInput(block.input)) return renderWrite(block, block.input);
  if (block.name === "edit" && isEditInput(block.input)) return renderEdit(block, block.input);

  const head = `${ansi.magenta(`[${block.name}]`)} ${JSON.stringify(block.input)}`;
  if (block.status === "running") return [`${head} ${ansi.cyan("⠋")}`];
  if (block.status === "done")
    return [`${head} ${ansi.dim(`→ ${JSON.stringify(extractResult(block.output))}`)}`];
  return [`${head} ${ansi.red(`✗ ${block.error}`)}`];
}

function renderCodemode(
  block: ToolCallBlock,
  input: { code: string },
  expanded: boolean,
): string[] {
  const metrics = extractMetrics(block.output);
  const toolCalls = metrics?.toolCalls ?? countCodemodeToolCalls(input.code);
  const metadata = [`${toolCalls} call${toolCalls === 1 ? "" : "s"}`];
  metadata.push(`${formatBytes(byteLength(input.code))} in`);
  if (block.status === "done") metadata.push(`${formatBytes(byteLength(block.output))} out`);
  const glyph = expanded || block.status === "running" ? "▼" : "▶";
  const summary = `${ansi.magenta(`${glyph} [${block.name}]`)} ${ansi.dim(metadata.join(" · "))}`;
  if (!expanded && block.status !== "running") {
    const tail =
      block.status === "error"
        ? ` ${ansi.red("✗ error")}`
        : extractResult(block.output) === undefined
          ? " ✓ done"
          : "";
    return [summary + tail];
  }
  const highlightedCode = getHighlighted(input.code, "ts") ?? input.code;
  const lines = [summary, ...highlightedCode.split("\n")];
  if (block.status === "done") {
    const result = formatCodemodeResult(block.output);
    lines.push(...(getHighlighted(result, "json") ?? result).split("\n"));
  }
  if (block.status === "error") lines.push(ansi.red(`✗ ${block.error}`));
  return lines;
}

function renderWrite(block: ToolCallBlock, input: { path: string; content: string }): string[] {
  const lang = inferLangFromPath(input.path);
  const content = lang ? (getHighlighted(input.content, lang) ?? input.content) : input.content;
  const lines = [
    `${ansi.magenta(`[${block.name}]`)} ${ansi.cyan(input.path)}${block.status === "running" ? ` ${ansi.cyan("⠋")}` : ""}`,
    ...content.split("\n"),
  ];
  const bytes = extractBytes(block.output);
  if (block.status === "done" && bytes !== null) lines.push(ansi.dim(`→ wrote ${bytes} bytes`));
  if (block.status === "error") lines.push(ansi.red(`✗ ${block.error}`));
  return lines;
}

function renderEdit(
  block: ToolCallBlock,
  input: { path: string; oldString: string; newString: string },
): string[] {
  const lines = [
    `${ansi.magenta(`[${block.name}]`)} ${ansi.cyan(input.path)}${block.status === "running" ? ` ${ansi.cyan("⠋")}` : ""}`,
  ];
  lines.push(...input.oldString.split("\n").map((line) => ansi.red(`- ${line}`)));
  lines.push(...input.newString.split("\n").map((line) => ansi.green(`+ ${line}`)));
  const replacements = extractReplacements(block.output);
  if (block.status === "done" && replacements !== null)
    lines.push(ansi.dim(`→ ${replacements} replacement${replacements === 1 ? "" : "s"}`));
  if (block.status === "error") lines.push(ansi.red(`✗ ${block.error}`));
  return lines;
}

function countCodemodeToolCalls(code: string): number {
  const calls = code.match(/\b(?:codemode|gh|git)\.[A-Za-z_$][\w$]*\s*\(/g);
  return calls?.length ?? 0;
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

const MAX_CODEMODE_STRING_CHARS = 4_000;

function truncateLargeStrings(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_CODEMODE_STRING_CHARS) return value;
    return `${value.slice(0, MAX_CODEMODE_STRING_CHARS)}\n… truncated ${formatBytes(byteLength(value))} string`;
  }
  if (Array.isArray(value)) return value.map((item) => truncateLargeStrings(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, truncateLargeStrings(nested)]),
    );
  }
  return value;
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
