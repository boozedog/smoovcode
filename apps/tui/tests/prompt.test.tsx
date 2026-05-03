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
      }),
    );
    expect(lastFrame() ?? "").toContain("█");
  });

  test("renders the cursor after typed text", async () => {
    const { lastFrame, stdin } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
      }),
    );
    stdin.write("abc");
    await flush();
    expect(lastFrame() ?? "").toContain("abc█");
  });

  test("ignores SGR mouse reports instead of inserting them into the prompt", async () => {
    const { lastFrame, stdin } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
      }),
    );
    stdin.write("\u001B[<64;26;50M\u001B[<65;26;50M");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> █");
    expect(frame).not.toContain("<64;26;50M");
    expect(frame).not.toContain("<65;26;50M");
  });

  test("moves the cursor to the newest line after Shift+Enter", async () => {
    const { lastFrame, stdin } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
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

  test("handles legacy Shift+Enter reports without inserting escape text", async () => {
    const { lastFrame, stdin } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
      }),
    );
    stdin.write("abc");
    await flush();
    stdin.write("\u001B[27;2;13~");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("abc");
    expect(frame).toContain("... █");
    expect(frame).not.toContain("[27;2;13~");
  });

  test("does not render a mode badge", () => {
    const { lastFrame } = render(
      React.createElement(Prompt, {
        onSubmit: () => {},
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("[plan]");
    expect(frame).not.toContain("[edit]");
    expect(frame).toContain(">");
  });

  test("Enter without text does not submit", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      React.createElement(Prompt, {
        onSubmit,
      }),
    );
    stdin.write("\r");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
