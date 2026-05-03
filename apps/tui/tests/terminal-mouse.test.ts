import { describe, expect, test } from "vite-plus/test";
import {
  disableMouseTrackingSequence,
  enableMouseTrackingSequence,
  isGhosttyTerminal,
} from "../src/terminal-mouse.ts";

describe("terminal mouse tracking", () => {
  test("detects Ghostty from TERM_PROGRAM", () => {
    expect(isGhosttyTerminal({ TERM_PROGRAM: "ghostty" })).toBe(true);
    expect(isGhosttyTerminal({ TERM_PROGRAM: "Ghostty" })).toBe(true);
    expect(isGhosttyTerminal({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
  });

  test("does not enable mouse reporting in Ghostty so native drag selection works", () => {
    const sequence = enableMouseTrackingSequence({ TERM_PROGRAM: "ghostty" });

    expect(sequence).toBe("");
  });

  test("does not disable mouse modes it did not enable in Ghostty", () => {
    expect(disableMouseTrackingSequence({ TERM_PROGRAM: "ghostty" })).toBe("");
  });

  test("keeps existing mouse behavior outside Ghostty", () => {
    expect(enableMouseTrackingSequence({ TERM_PROGRAM: "xterm" })).toBe(
      "\u001B[?1000h\u001B[?1002h\u001B[?1006h",
    );
    expect(disableMouseTrackingSequence({ TERM_PROGRAM: "xterm" })).toBe(
      "\u001B[?1000l\u001B[?1002l\u001B[?1006l",
    );
  });
});
