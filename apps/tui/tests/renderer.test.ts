import { describe, expect, test } from "vite-plus/test";
import { FakeTerminal, TerminalRenderer } from "../src/renderer.ts";

describe("TerminalRenderer", () => {
  test("appends new lines without repainting unchanged scrollback", () => {
    const term = new FakeTerminal({ rows: 5, cols: 80 });
    const renderer = new TerminalRenderer(term);

    renderer.render(["banner", "first"], { force: true });
    term.clearOutput();

    renderer.render(["banner", "first", "second"]);

    expect(term.output).toContain("\r\n");
    expect(term.output).toContain("second");
    expect(term.output).not.toContain("banner");
  });

  test("updates only the bottom changed region", () => {
    const term = new FakeTerminal({ rows: 5, cols: 80 });
    const renderer = new TerminalRenderer(term);

    renderer.render(["banner", "working 1s"], { force: true });
    term.clearOutput();

    renderer.render(["banner", "working 2s"]);

    expect(term.output).toContain("working 2s");
    expect(term.output).not.toContain("banner");
  });

  test("full redraws on width changes", () => {
    const term = new FakeTerminal({ rows: 5, cols: 80 });
    const renderer = new TerminalRenderer(term);

    renderer.render(["a"], { force: true });
    term.clearOutput();
    term.cols = 40;
    renderer.render(["a"]);

    expect(term.output).toContain("\u001b[2J");
    expect(term.output).toContain("a\u001b[?2026l");
  });
});
