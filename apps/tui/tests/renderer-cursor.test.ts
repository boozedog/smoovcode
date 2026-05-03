import { describe, expect, test } from "vite-plus/test";
import { FakeTerminal, TerminalRenderer } from "../src/renderer.ts";

describe("TerminalRenderer cursor placement", () => {
  test("leaves the hardware cursor at the end of the final line by default", () => {
    const term = new FakeTerminal({ rows: 5, cols: 80 });
    const renderer = new TerminalRenderer(term);

    renderer.render(["banner", "> hello"], { force: true });

    expect(term.output.endsWith("> hello\u001b[?2026l")).toBe(true);
  });

  test("appends from the end of the previous final line", () => {
    const term = new FakeTerminal({ rows: 5, cols: 80 });
    const renderer = new TerminalRenderer(term);

    renderer.render(["a"], { force: true });
    term.clearOutput();
    renderer.render(["a", "b"]);

    expect(term.output).toContain("\r\n");
    expect(term.output).toContain("b");
    expect(term.output).not.toContain("a");
  });
});
