import type { Block, Turn } from "@smoovcode/ui-core";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { TurnView } from "../src/turn-view.tsx";

function makeTurn(blocks: Block[] = []): Turn {
  return {
    id: 0,
    userMessage: "hello",
    blocks,
    status: "streaming",
  };
}

describe("TurnView", () => {
  test("renders the user prompt prefixed with `> `", () => {
    const { lastFrame } = render(React.createElement(TurnView, { turn: makeTurn() }));
    expect(lastFrame()).toContain("> hello");
  });

  test("renders one BlockView per block in order", () => {
    const turn = makeTurn([
      { kind: "text", id: "b-0-0", text: "answer one", status: "done" },
      { kind: "text", id: "b-0-1", text: "answer two", status: "streaming" },
    ]);
    const { lastFrame } = render(React.createElement(TurnView, { turn }));
    const frame = lastFrame() ?? "";
    const i1 = frame.indexOf("answer one");
    const i2 = frame.indexOf("answer two");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
  });

  test("renders an empty turn as just the user prompt", () => {
    const { lastFrame } = render(React.createElement(TurnView, { turn: makeTurn() }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("> hello");
    expect(frame).not.toContain("[error]");
  });
});
