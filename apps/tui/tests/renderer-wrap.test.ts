import { describe, expect, test } from "vite-plus/test";
import { FakeTerminal, TerminalRenderer } from "../src/renderer.ts";

describe("TerminalRenderer wrapping", () => {
  test("wraps at one less than terminal width to avoid terminal autowrap", () => {
    const term = new FakeTerminal({ rows: 10, cols: 10 });
    const renderer = new TerminalRenderer(term);

    renderer.render(["abcdefghij"], { force: true });

    expect(term.output).toContain("abcdefghi\r\nj");
    expect(term.output).not.toContain("abcdefghij\r\n");
  });
});
