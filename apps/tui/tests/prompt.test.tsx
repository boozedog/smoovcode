import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test, vi } from "vite-plus/test";
import { Prompt } from "../src/prompt.tsx";

describe("Prompt", () => {
  test("renders the mode badge inline with the prompt", () => {
    const { lastFrame } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
        mode: "plan",
        onCycleMode: () => {},
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[plan]");
    expect(frame).toContain(">");
  });

  test("Shift+Tab calls onCycleMode", () => {
    const onCycleMode = vi.fn();
    const { stdin } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
        mode: "edit",
        onCycleMode,
      }),
    );
    // ANSI CSI Z is the canonical escape sequence Ink decodes as shift+tab.
    stdin.write("\u001B[Z");
    expect(onCycleMode).toHaveBeenCalledTimes(1);
  });

  test("Enter without text does not submit", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      React.createElement(Prompt, {
        onSubmit,
        mode: "edit",
        onCycleMode: () => {},
      }),
    );
    stdin.write("\r");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
