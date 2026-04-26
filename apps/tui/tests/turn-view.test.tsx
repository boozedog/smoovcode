import type { Turn } from "@smoovcode/ui-core";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { TurnView } from "../src/turn-view.tsx";

function makeTurn(partial: Partial<Turn> = {}): Turn {
  return {
    id: 0,
    userMessage: "hello",
    text: "",
    reasoning: "",
    toolCalls: [],
    errors: [],
    status: "streaming",
    ...partial,
  };
}

describe("TurnView", () => {
  test("renders the user prompt prefixed with `> `", () => {
    const { lastFrame } = render(React.createElement(TurnView, { turn: makeTurn() }));
    expect(lastFrame()).toContain("> hello");
  });

  test("renders accumulated text", () => {
    const { lastFrame } = render(
      React.createElement(TurnView, { turn: makeTurn({ text: "the answer" }) }),
    );
    expect(lastFrame()).toContain("the answer");
  });

  test("renders reasoning prefixed with `thinking:`", () => {
    const { lastFrame } = render(
      React.createElement(TurnView, { turn: makeTurn({ reasoning: "consider" }) }),
    );
    expect(lastFrame()).toContain("thinking: consider");
  });

  test("renders tool calls with name, input, and result on completion", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "tc-0-0",
          name: "echo",
          input: { x: 1 },
          status: "done",
          output: { result: "ok" },
        },
      ],
    });
    const { lastFrame } = render(React.createElement(TurnView, { turn }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain('[echo] {"x":1}');
    expect(frame).toContain('→ "ok"');
  });

  test("renders tool errors with the ✗ marker", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "tc-0-0",
          name: "t",
          input: {},
          status: "error",
          error: "boom",
        },
      ],
    });
    const { lastFrame } = render(React.createElement(TurnView, { turn }));
    expect(lastFrame()).toContain("[t] {} ✗ boom");
  });

  test("renders [error] lines for stream-level errors", () => {
    const { lastFrame } = render(
      React.createElement(TurnView, { turn: makeTurn({ errors: ["oops"] }) }),
    );
    expect(lastFrame()).toContain("[error] oops");
  });
});
