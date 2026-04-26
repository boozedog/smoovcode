import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { useTickFlush } from "../src/use-tick-flush.ts";

describe("useTickFlush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("invokes the flush callback every `ms` while mounted", () => {
    const flush = vi.fn();
    const Component = () => {
      useTickFlush(flush, 100);
      return null;
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Component));
    });
    expect(flush).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(flush).toHaveBeenCalledTimes(2);
    act(() => {
      renderer.unmount();
    });
  });

  test("stops invoking the callback after unmount", () => {
    const flush = vi.fn();
    const Component = () => {
      useTickFlush(flush, 100);
      return null;
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Component));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(flush).toHaveBeenCalledTimes(1);
    act(() => {
      renderer.unmount();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  test("uses the latest callback (it does not capture the initial closure)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const Component = ({ cb }: { cb: () => void }) => {
      useTickFlush(cb, 100);
      return null;
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Component, { cb: a }));
    });
    act(() => {
      renderer.update(React.createElement(Component, { cb: b }));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    act(() => {
      renderer.unmount();
    });
  });
});
