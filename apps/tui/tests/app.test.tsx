import type { HostApprovalRequest } from "@smoovcode/agent";
import { ApprovalQueue } from "@smoovcode/ui-core";
import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { App } from "../src/app.tsx";

const inkMocks = vi.hoisted(() => ({
  exit: vi.fn(),
}));

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    useApp: () => ({
      exit: inkMocks.exit,
      waitUntilRenderFlush: async () => {},
    }),
  };
});

describe("App", () => {
  afterEach(() => {
    inkMocks.exit.mockClear();
  });

  test("Ctrl+C exits even when the prompt has focus", () => {
    const agent = {
      async *run() {
        yield { type: "text" as const, delta: "" };
      },
    };
    const { stdin } = render(
      React.createElement(App, {
        agent,
        approvalQueue: new ApprovalQueue<HostApprovalRequest>(),
        banner: "banner",
      }),
    );

    stdin.write("\u0003");

    expect(inkMocks.exit).toHaveBeenCalledTimes(1);
  });
});
