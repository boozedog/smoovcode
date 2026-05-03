import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { formatStatusLine, StatusLine } from "../src/status-line.tsx";

describe("StatusLine", () => {
  test("formats a Pi-style persistent stats line", () => {
    const line = formatStatusLine({
      cwd: "/tmp/smoovcode",
      branch: "main",
      inputTokens: 217_000,
      outputTokens: 13_000,
      costUsd: 2.464,
      subscription: true,
      contextPercent: 19.8,
      contextWindow: 272_000,
      model: "gpt-5.5",
      effort: "medium",
    });

    expect(line).toContain("/tmp/smoovcode (main)");
    expect(line).toContain("↑217k");
    expect(line).toContain("↓13k");
    expect(line).toContain("$2.464");
    expect(line).toContain("(sub)");
    expect(line).toContain("19.8%/272k");
    expect(line).toContain("gpt-5.5 • medium");
  });

  test("renders even when usage and cost are not available", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, { stats: { cwd: "/tmp/smoovcode", branch: "main" } }),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("/tmp/smoovcode (main)");
    expect(frame).toContain("↑0");
    expect(frame).toContain("↓0");
  });
});
