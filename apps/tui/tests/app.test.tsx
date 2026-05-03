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

async function flush() {
  await new Promise((r) => setTimeout(r, 300));
}

describe("App", () => {
  afterEach(() => {
    inkMocks.exit.mockClear();
  });

  test("renders a persistent bottom stats line", () => {
    const agent = {
      async *run() {
        yield { type: "text" as const, delta: "" };
      },
    };
    const { lastFrame } = render(
      React.createElement(App, {
        agent,
        approvalQueue: new ApprovalQueue<HostApprovalRequest>(),
        banner: "banner",
        stats: { cwd: "/tmp/smoovcode", branch: "main", model: "gpt-x", effort: "medium" },
      }),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("smoovcode on main");
    expect(frame).toContain("[gpt-x]");
  });

  test("streams assistant chat text into the transcript without streaming tool-call blocks", async () => {
    const never = new Promise<void>(() => {});
    const agent = {
      async *run() {
        yield { type: "text" as const, delta: "hello" };
        yield { type: "tool-call" as const, name: "codemode", input: { code: "1" } };
        await never;
      },
    };
    const { lastFrame, stdin } = render(
      React.createElement(App, {
        agent,
        approvalQueue: new ApprovalQueue<HostApprovalRequest>(),
        banner: "banner",
      }),
    );

    stdin.write("go");
    await flush();
    stdin.write("\r");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("hello");
    expect(frame).not.toContain("▶ [codemode]");
    expect(frame).toContain("working");
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

  test("warns before discarding dirty staged changes on exit", async () => {
    const agent = {
      session: { dirty: { isDirty: () => true } },
      async *run() {
        yield { type: "text" as const, delta: "" };
      },
    };
    const { lastFrame, stdin } = render(
      React.createElement(App, {
        agent,
        approvalQueue: new ApprovalQueue<HostApprovalRequest>(),
        banner: "banner",
      }),
    );

    stdin.write("\u0003");
    await flush();

    expect(lastFrame() ?? "").toContain("Exit and discard");
    expect(inkMocks.exit).not.toHaveBeenCalled();
    stdin.write("y");
    expect(inkMocks.exit).toHaveBeenCalledTimes(1);
  });
});
