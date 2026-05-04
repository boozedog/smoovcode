import type { Block } from "@smoovcode/ui-core";
import { describe, expect, test } from "vite-plus/test";
import { renderBlock } from "../src/render-block.ts";
import { FakeTerminal, TerminalRenderer } from "../src/renderer.ts";

const ESC = "\u001b[";

const ansiPattern = new RegExp(`${ESC.replace("[", "\\[")}[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

describe("ANSI formatting", () => {
  test("colors edit diff lines", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "edit",
      input: { path: "src/foo.ts", oldString: "old", newString: "new" },
      status: "done",
      output: { replacements: 1 },
    };

    const output = renderBlock(block).join("\n");

    expect(output).toContain(`${ESC}31m- old${ESC}39m`);
    expect(output).toContain(`${ESC}32m+ new${ESC}39m`);
    expect(stripAnsi(output)).toContain("[edit] src/foo.ts");
  });

  test("renders errors in red and reasoning dim", () => {
    expect(
      renderBlock({ kind: "error", id: "e", error: "boom", status: "done" }).join("\n"),
    ).toContain(`${ESC}31m[error] boom${ESC}39m`);
    expect(
      renderBlock({ kind: "reasoning", id: "r", text: "consider", status: "done" }).join("\n"),
    ).toContain(`${ESC}2mthinking: consider${ESC}22m`);
  });

  test("codemode summary shows nested tool-call count instead of source line count", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "codemode",
      input: {
        code: [
          "async () => {",
          "  await codemode.bash({ command: 'pwd' });",
          "  await codemode.astGrep({ pattern: 'foo' });",
          "}",
        ].join("\n"),
      },
      status: "done",
      output: { result: "ok" },
    };

    const output = stripAnsi(renderBlock(block).join("\n"));

    expect(output).toContain("▶ [codemode] 2 calls");
    expect(output).not.toContain("4 lines");
  });

  test("codemode summary counts host capability calls", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "codemode",
      input: {
        code: [
          "async () => {",
          "  await gh.issue_list({ state: 'open' });",
          "  await git.status({});",
          "}",
        ].join("\n"),
      },
      status: "done",
      output: { result: "ok" },
    };

    const output = stripAnsi(renderBlock(block).join("\n"));

    expect(output).toContain("▶ [codemode] 2 calls");
  });

  test("codemode summary prefers executor metrics when present", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "codemode",
      input: { code: "async () => await codemode.bash({ command: 'pwd' })" },
      status: "done",
      output: { result: "ok", metrics: { toolCalls: 3 } },
    };

    expect(stripAnsi(renderBlock(block).join("\n"))).toContain("▶ [codemode] 3 calls");
  });

  test("codemode expanded output truncates very large string fields", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "codemode",
      input: { code: "async () => await git.diff({ paths: [] })" },
      status: "done",
      output: { result: { stdout: `head-${"x".repeat(20_000)}-tail` } },
    };

    const output = stripAnsi(renderBlock(block, { expandedCodemode: true }).join("\n"));

    expect(output).toContain("head-");
    expect(output).toContain("… truncated");
    expect(output).not.toContain("-tail");
  });

  test("wraps ANSI-styled text by visible width", () => {
    const term = new FakeTerminal({ rows: 10, cols: 10 });
    const renderer = new TerminalRenderer(term);

    renderer.render([`${ESC}31mabcdefghi${ESC}39mj`], { force: true });

    expect(term.output).toContain(`${ESC}31mabcdefghi${ESC}39m\r\nj`);
  });
});
