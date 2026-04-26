import type { Block } from "@smoovcode/ui-core";
import { Box, Static, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { BlockView } from "../src/block-view.tsx";

/**
 * Acceptance test: a finalized block rendered inside `<Static>` must produce
 * byte-identical output to the same block rendered in the live region. This
 * is the property that makes the streaming → scrollback handoff invisible
 * (no flashing, no reflow) as blocks are flushed one at a time.
 */
describe("byte-identical handoff", () => {
  function textBlock(text: string): Block {
    return { kind: "text", id: "b-0-0", text, status: "done" };
  }

  test("a BlockView inside <Static> renders identical bytes to a BlockView in the live region", () => {
    const block = textBlock("Hello, world!");

    const live = render(React.createElement(BlockView, { block }));

    const items = [{ key: "b-0-0", block }];
    const finalized = render(
      React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Static, {
          items,
          children: ((item: { key: string; block: Block }) =>
            React.createElement(
              Box,
              { key: item.key },
              React.createElement(BlockView, { block: item.block }),
            )) as (item: unknown, index: number) => React.ReactNode,
        }),
      ),
    );

    expect(finalized.lastFrame()?.trimEnd()).toBe(live.lastFrame()?.trimEnd());
  });

  test("rendered block bytes are stable across renders (no time-dependent rendering for done text)", () => {
    const a = render(React.createElement(BlockView, { block: textBlock("Hello") }));
    const frameA = a.lastFrame();
    a.unmount();

    const b = render(React.createElement(BlockView, { block: textBlock("Hello") }));
    expect(b.lastFrame()).toBe(frameA);
  });

  test("a block rendered through <Static> alongside a banner preserves the block's bytes", () => {
    const block = textBlock("answer");
    type Item =
      | { kind: "banner"; key: string; text: string }
      | { kind: "block"; key: string; block: Block };
    const items: Item[] = [
      { kind: "banner", key: "banner", text: "smoovcode" },
      { kind: "block", key: "b-0-0", block },
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
                React.createElement(BlockView, { block: item.block }),
              )) as (item: unknown, index: number) => React.ReactNode,
      }),
    );

    const frame = out.lastFrame() ?? "";
    const liveOnly = render(React.createElement(BlockView, { block })).lastFrame() ?? "";
    expect(frame.includes(liveOnly)).toBe(true);
  });
});
