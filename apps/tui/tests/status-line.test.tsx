import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { formatStatusLine, StatusLine } from "../src/status-line.tsx";

describe("StatusLine", () => {
  test("formats a Claude-style two-line status", () => {
    const line = formatStatusLine({
      cwd: "/tmp/smoovmux",
      branch: "master*",
      contextPercent: 97,
      contextWindow: 1_000_000,
      model: "Opus 4.7",
      revision: "cd08d5f4",
    });

    expect(line).toBe("smoovmux on master*\n[Opus 4.7 (1M context)] cd08d5f4 97%");
  });

  test("renders even when usage and cost are not available", () => {
    const { lastFrame } = render(
      React.createElement(StatusLine, { stats: { cwd: "/tmp/smoovcode", branch: "main" } }),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("smoovcode on main");
    expect(frame).toContain("[gpt-5]");
    expect(frame).not.toContain("┌");
  });
});
