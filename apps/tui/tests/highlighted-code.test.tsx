import { render } from "ink-testing-library";
import { createElement } from "react";
import { describe, expect, test } from "vite-plus/test";
import { HighlightedCode } from "../src/highlighted-code.tsx";

async function waitFrames(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("HighlightedCode", () => {
  test("renders the raw code on first frame (before async highlight resolves)", () => {
    const { lastFrame } = render(
      createElement(HighlightedCode, { code: 'const x = "hi";', lang: "ts" }),
    );
    expect(lastFrame()).toContain('const x = "hi";');
  });

  test("re-renders with ANSI escape sequences once syntax highlighting completes", async () => {
    const { lastFrame } = render(
      createElement(HighlightedCode, {
        code: 'const x = "hi";\nconsole.log(x);',
        lang: "ts",
      }),
    );
    await waitFrames();
    const frame = lastFrame() ?? "";
    // The original tokens are still there...
    expect(frame).toContain("const");
    expect(frame).toContain("console");
    // ...but the frame now contains ANSI escape codes from the highlighter.
    expect(frame).toContain("\u001B[");
  });

  test("renders JSON when lang='json'", async () => {
    const code = JSON.stringify({ ok: true, n: 42 }, null, 2);
    const { lastFrame } = render(createElement(HighlightedCode, { code, lang: "json" }));
    await waitFrames();
    const frame = lastFrame() ?? "";
    expect(frame).toContain('"ok"');
    expect(frame).toContain("42");
  });

  test("falls back to raw text if highlighting throws (unknown language)", async () => {
    const { lastFrame } = render(
      // Cast — we deliberately pass an unsupported language to exercise the fallback.
      createElement(HighlightedCode, {
        code: "anything goes here",
        lang: "klingon" as never,
      }),
    );
    await waitFrames();
    expect(lastFrame()).toContain("anything goes here");
  });
});
