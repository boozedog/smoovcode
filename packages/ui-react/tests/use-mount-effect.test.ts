import { createElement, type ReactElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, test, vi } from "vite-plus/test";
import { useMountEffect } from "../src/use-mount-effect.ts";

function render(element: ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer!;
}

describe("useMountEffect", () => {
  test("runs the effect once on mount", () => {
    const effect = vi.fn();
    const Component = () => {
      useMountEffect(effect);
      return null;
    };
    render(createElement(Component));
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test("does not re-run on parent re-render", () => {
    const effect = vi.fn();
    const Component = ({ x }: { x: number }) => {
      useMountEffect(effect);
      return createElement("text", null, String(x));
    };
    const renderer = render(createElement(Component, { x: 0 }));
    expect(effect).toHaveBeenCalledTimes(1);
    act(() => {
      renderer.update(createElement(Component, { x: 1 }));
    });
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test("invokes the cleanup function returned by the effect on unmount", () => {
    const cleanup = vi.fn();
    const Component = () => {
      useMountEffect(() => cleanup);
      return null;
    };
    const renderer = render(createElement(Component));
    expect(cleanup).not.toHaveBeenCalled();
    act(() => {
      renderer.unmount();
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("a fresh `key` remounts the component, re-running the effect (Rule 5)", () => {
    const effect = vi.fn();
    const Component = () => {
      useMountEffect(effect);
      return null;
    };
    const wrapper = (k: string) => createElement(Component, { key: k });
    const renderer = render(wrapper("a"));
    expect(effect).toHaveBeenCalledTimes(1);
    act(() => {
      renderer.update(wrapper("b"));
    });
    expect(effect).toHaveBeenCalledTimes(2);
  });
});
