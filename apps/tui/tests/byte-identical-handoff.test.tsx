import type { Turn } from "@smoovcode/ui-core";
import { Box, Static, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { TurnView } from "../src/turn-view.tsx";

/**
 * Acceptance test from issue #2: a finalized turn rendered inside `<Static>`
 * must produce byte-identical output to a live turn rendered with the same
 * turn data. This is the property that makes the streaming → scrollback
 * handoff invisible (no flashing, no reflow).
 */
describe("byte-identical handoff", () => {
  function makeTurn(text: string): Turn {
    return {
      id: 0,
      userMessage: "ask",
      text,
      reasoning: "",
      toolCalls: [],
      errors: [],
      status: "done",
    };
  }

  test("a TurnView inside <Static> renders identical bytes to a TurnView in the live region", () => {
    const turn = makeTurn("Hello, world!");

    // Live: just <TurnView> (matches what <LiveTurn> renders once data arrives).
    const live = render(React.createElement(TurnView, { turn }));

    // Finalized: <TurnView> wrapped in <Static>, mirroring App's structure.
    const items = [{ key: "t-0", turn }];
    const finalized = render(
      React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Static, {
          items,
          children: ((item: { key: string; turn: Turn }) =>
            React.createElement(
              Box,
              { key: item.key },
              React.createElement(TurnView, { turn: item.turn }),
            )) as (item: unknown, index: number) => React.ReactNode,
        }),
      ),
    );

    // <Static> commits with a trailing newline; the turn's bytes themselves
    // are byte-identical to the live render.
    expect(finalized.lastFrame()?.trimEnd()).toBe(live.lastFrame()?.trimEnd());
  });

  test("the rendered turn bytes do not change as more text would arrive (snapshot stability)", () => {
    // First render
    const a = render(React.createElement(TurnView, { turn: makeTurn("Hello") }));
    const frameA = a.lastFrame();
    a.unmount();

    // Same data, fresh render
    const b = render(React.createElement(TurnView, { turn: makeTurn("Hello") }));
    expect(b.lastFrame()).toBe(frameA);
  });

  test("a turn rendered through <Static> with a banner header preserves the turn's bytes", () => {
    const turn = makeTurn("answer");
    type Item =
      | { kind: "banner"; key: string; text: string }
      | { kind: "turn"; key: string; turn: Turn };
    const items: Item[] = [
      { kind: "banner", key: "banner", text: "smoovcode" },
      { kind: "turn", key: "t-0", turn },
    ];
    const out = render(
      React.createElement(Static, {
        items,
        children: ((item: Item) =>
          item.kind === "banner"
            ? React.createElement(Text, { key: item.key, dimColor: true }, item.text)
            : React.createElement(
                Box,
                { key: item.key },
                React.createElement(TurnView, { turn: item.turn }),
              )) as (item: unknown, index: number) => React.ReactNode,
      }),
    );

    const frame = out.lastFrame() ?? "";
    // The turn's content is preserved exactly inside the larger frame.
    const liveOnly = render(React.createElement(TurnView, { turn })).lastFrame() ?? "";
    expect(frame.includes(liveOnly)).toBe(true);
  });
});
