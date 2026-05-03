import { ApprovalQueue } from "@smoovcode/ui-core";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { useApprovalQueue } from "../src/use-approval-queue.ts";

interface Captured<T> {
  pending: T | null;
  resolve: (approved: boolean) => void;
}

function harness<T>(queue: ApprovalQueue<T>): {
  renderer: TestRenderer.ReactTestRenderer;
  current: () => Captured<T>;
} {
  const captured: { last: Captured<T> | null } = { last: null };
  const Probe = () => {
    const value = useApprovalQueue(queue);
    captured.last = value;
    return null;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(createElement(Probe));
  });
  return {
    renderer,
    current: () => {
      if (!captured.last) throw new Error("hook never rendered");
      return captured.last;
    },
  };
}

describe("useApprovalQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns pending=null when the queue is empty", () => {
    const queue = new ApprovalQueue<{ argv: string[] }>();
    const h = harness(queue);
    expect(h.current().pending).toBeNull();
  });

  test("re-renders with the head request after enqueue", () => {
    const queue = new ApprovalQueue<{ argv: string[] }>();
    const h = harness(queue);
    act(() => {
      void queue.enqueue({ argv: ["ls"] });
    });
    expect(h.current().pending).toEqual({ argv: ["ls"] });
  });

  test("resolve() drains the head and the hook returns null again (when queue empties)", async () => {
    const queue = new ApprovalQueue<{ argv: string[] }>();
    const h = harness(queue);
    let p!: Promise<boolean>;
    act(() => {
      p = queue.enqueue({ argv: ["x"] });
    });
    expect(h.current().pending).toEqual({ argv: ["x"] });
    act(() => {
      h.current().resolve(true);
    });
    await expect(p).resolves.toBe(true);
    expect(h.current().pending).toBeNull();
  });

  test("unsubscribes from the queue on unmount (no leaks)", () => {
    const queue = new ApprovalQueue<{ argv: string[] }>();
    const h = harness(queue);
    act(() => {
      h.renderer.unmount();
    });
    // Enqueue after unmount must not throw or trigger a re-render.
    expect(() => {
      void queue.enqueue({ argv: ["after"] });
    }).not.toThrow();
  });
});
