import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test, vi } from "vite-plus/test";
import { Prompt } from "../src/prompt.tsx";

async function flush() {
  await new Promise((r) => setTimeout(r, 20));
}

describe("Prompt", () => {
  test("renders a visible block cursor when the input is empty", () => {
    const { lastFrame } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
        mode: "edit",
        onCycleMode: () => {},
      }),
    );
    expect(lastFrame() ?? "").toContain("█");
  });

  test("renders the cursor after typed text", async () => {
    const { lastFrame, stdin } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
        mode: "edit",
        onCycleMode: () => {},
      }),
    );
    stdin.write("abc");
    await flush();
    expect(lastFrame() ?? "").toContain("abc█");
  });

  test("moves the cursor to the newest line after Shift+Enter", async () => {
    const { lastFrame, stdin } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
        mode: "edit",
        onCycleMode: () => {},
      }),
    );
    stdin.write("abc");
    await flush();
    stdin.write("\u001B[13;2u");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("abc");
    expect(frame).toContain("... █");
  });

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
