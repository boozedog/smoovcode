import { describe, expect, test } from "vite-plus/test";
import { FakeTerminal, TerminalRenderer } from "../src/renderer.ts";

describe("TerminalRenderer suffix preservation", () => {
  test("editing prompt above status does not rewrite unchanged status suffix", () => {
    const term = new FakeTerminal({ rows: 10, cols: 80 });
    const renderer = new TerminalRenderer(term);

    renderer.render(["> a", "status", "model"], { force: true, cursor: { line: 0, column: 3 } });
    term.clearOutput();

    renderer.render(["> ab", "status", "model"], { cursor: { line: 0, column: 4 } });

    expect(term.output).toContain("> ab");
    expect(term.output).not.toContain("status");
    expect(term.output).not.toContain("model");
  });
});
