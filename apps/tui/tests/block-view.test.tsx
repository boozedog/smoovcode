import type { Block } from "@smoovcode/ui-core";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { BlockView } from "../src/block-view.tsx";

describe("BlockView", () => {
  test("renders a text block as markdown content", () => {
    const block: Block = {
      kind: "text",
      id: "b-0-0",
      text: "# heading\nsome **bold** text",
      status: "done",
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("heading");
    expect(frame).toContain("bold");
  });

  test("renders a reasoning block prefixed with `thinking:`", () => {
    const block: Block = {
      kind: "reasoning",
      id: "b-0-0",
      text: "consider",
      status: "done",
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    expect(lastFrame()).toContain("thinking: consider");
  });

  test("renders a generic tool-call with name + input + result on completion", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "echo",
      input: { x: 1 },
      status: "done",
      output: { result: "ok" },
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain('[echo] {"x":1}');
    expect(frame).toContain('→ "ok"');
  });

  test("renders a tool-call error with the ✗ marker", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "t",
      input: {},
      status: "error",
      error: "boom",
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    expect(lastFrame()).toContain("[t] {} ✗ boom");
  });

  test("renders a running tool-call with a visible spinner glyph", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "echo",
      input: { x: 1 },
      status: "running",
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[echo]");
    // The spinner emits one of the braille frames; assert at least one is present.
    expect(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(frame)).toBe(true);
  });

  test("renders a codemode tool-call with the TS source highlighted", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "codemode",
      input: { code: 'const x = "hello";' },
      status: "done",
      output: { result: { ok: true } },
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[codemode]");
    expect(frame).toContain('const x = "hello";');
    expect(frame).toContain('"ok"');
  });

  test("renders a write block with the path header and the file contents", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "write",
      input: { path: "src/foo.ts", content: 'export const x = "hi";' },
      status: "done",
      output: { path: "src/foo.ts", bytes: 23 },
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[write]");
    expect(frame).toContain("src/foo.ts");
    expect(frame).toContain('export const x = "hi";');
    expect(frame).toContain("23 bytes");
  });

  test("renders an edit block with `-` old lines and `+` new lines", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "edit",
      input: { path: "src/foo.ts", oldString: "old code", newString: "new code" },
      status: "done",
      output: { path: "src/foo.ts", replacements: 1 },
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[edit]");
    expect(frame).toContain("src/foo.ts");
    expect(frame).toContain("- old code");
    expect(frame).toContain("+ new code");
    expect(frame).toContain("1 replacement");
  });

  test("edit block prefixes every line of multi-line old/new strings", () => {
    const block: Block = {
      kind: "tool-call",
      id: "b-0-0",
      name: "edit",
      input: {
        path: "src/foo.ts",
        oldString: "line1\nline2",
        newString: "newA\nnewB\nnewC",
      },
      status: "done",
      output: { path: "src/foo.ts", replacements: 1 },
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("- line1");
    expect(frame).toContain("- line2");
    expect(frame).toContain("+ newA");
    expect(frame).toContain("+ newB");
    expect(frame).toContain("+ newC");
  });

  test("renders an error block with a red [error] line", () => {
    const block: Block = {
      kind: "error",
      id: "b-0-0",
      error: "oops",
      status: "done",
    };
    const { lastFrame } = render(React.createElement(BlockView, { block }));
    expect(lastFrame()).toContain("[error] oops");
  });
});
