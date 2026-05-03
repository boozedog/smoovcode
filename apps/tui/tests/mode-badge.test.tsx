import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, test } from "vite-plus/test";
import { ModeBadge } from "../src/mode-badge.tsx";

describe("ModeBadge", () => {
  test("renders [edit] for edit mode", () => {
    const { lastFrame } = render(React.createElement(ModeBadge, { mode: "edit" }));
    expect(lastFrame()).toContain("[edit]");
  });

  test("renders [plan] for plan mode", () => {
    const { lastFrame } = render(React.createElement(ModeBadge, { mode: "plan" }));
    expect(lastFrame()).toContain("[plan]");
  });
});
