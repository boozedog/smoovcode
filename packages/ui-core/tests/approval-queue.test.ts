import { describe, expect, test, vi } from "vite-plus/test";
import { ApprovalQueue } from "../src/index.ts";

describe("ApprovalQueue", () => {
  test("starts empty: peek is null and size is 0", () => {
    const q = new ApprovalQueue<{ argv: string[] }>();
    expect(q.peek()).toBeNull();
    expect(q.size()).toBe(0);
  });

  test("enqueue returns a pending promise that resolves when the UI calls resolve(true)", async () => {
    const q = new ApprovalQueue<{ argv: string[] }>();
    const p = q.enqueue({ argv: ["ls"] });
    expect(q.size()).toBe(1);
    expect(q.peek()).toEqual({ argv: ["ls"] });
    q.resolve(true);
    await expect(p).resolves.toBe(true);
    expect(q.size()).toBe(0);
    expect(q.peek()).toBeNull();
  });

  test("resolve(false) resolves the pending promise to false", async () => {
    const q = new ApprovalQueue<{ argv: string[] }>();
    const p = q.enqueue({ argv: ["rm"] });
    q.resolve(false);
    await expect(p).resolves.toBe(false);
  });

  test("requests are FIFO: peek surfaces the oldest until resolved", async () => {
    const q = new ApprovalQueue<{ argv: string[] }>();
    const a = q.enqueue({ argv: ["a"] });
    const b = q.enqueue({ argv: ["b"] });
    expect(q.peek()).toEqual({ argv: ["a"] });
    q.resolve(true);
    expect(q.peek()).toEqual({ argv: ["b"] });
    q.resolve(false);
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(false);
  });

  test("resolve with no pending request throws (programmer error, not silent)", () => {
    const q = new ApprovalQueue<{ argv: string[] }>();
    expect(() => q.resolve(true)).toThrow();
  });

  test("subscribe is invoked on enqueue and on resolve, and unsubscribe removes the listener", () => {
    const q = new ApprovalQueue<{ argv: string[] }>();
    const listener = vi.fn();
    const unsub = q.subscribe(listener);
    void q.enqueue({ argv: ["a"] });
    expect(listener).toHaveBeenCalledTimes(1);
    q.resolve(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    void q.enqueue({ argv: ["b"] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("each enqueue gets its own promise (resolving once does not affect later requests)", async () => {
    const q = new ApprovalQueue<{ argv: string[] }>();
    const a = q.enqueue({ argv: ["a"] });
    q.resolve(true);
    await expect(a).resolves.toBe(true);
    const b = q.enqueue({ argv: ["b"] });
    q.resolve(false);
    await expect(b).resolves.toBe(false);
  });
});
