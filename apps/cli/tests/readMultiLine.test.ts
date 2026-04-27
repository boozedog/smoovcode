import { stdin, stdout } from "node:process";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Mock stdin methods
const mockSetRawMode = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();

// Capture the data handler
let dataHandler: ((chunk: Buffer) => void) | null = null;

vi.mock("node:process", async () => {
  const actual = await vi.importActual<typeof import("node:process")>("node:process");
  return {
    ...actual,
    stdin: {
      ...actual.stdin,
      setRawMode: (...args: unknown[]) => mockSetRawMode(...args),
      on: (event: string, handler: (chunk: Buffer) => void) => {
        mockOn(event, handler);
        if (event === "data") {
          dataHandler = handler;
        }
        return stdin;
      },
      removeListener: (...args: unknown[]) => mockRemoveListener(...args),
      pause: () => mockPause(),
      resume: () => mockResume(),
      isTTY: true,
    },
  };
});

let writes: string[] = [];

import { readMultiLine } from "../src/readMultiLine.js";

describe("readMultiLine", () => {
  beforeEach(() => {
    writes = [];
    vi.spyOn(stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as unknown as typeof stdout.write);
    mockSetRawMode.mockClear();
    mockOn.mockClear();
    mockRemoveListener.mockClear();
    mockPause.mockClear();
    mockResume.mockClear();
    dataHandler = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("prints initial prompt and enables raw mode", async () => {
    const promise = readMultiLine();

    // Should have printed the initial prompt
    expect(writes).toContain("\n> ");
    expect(mockSetRawMode).toHaveBeenCalledWith(true);
    expect(mockResume).toHaveBeenCalled();

    // Complete the input
    dataHandler!(Buffer.from("\r"));

    await expect(promise).resolves.toBe("");
  });

  test("submits input on Enter (\\r)", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("hello"));
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("hello");
    expect(mockSetRawMode).toHaveBeenCalledWith(false);
  });

  test("submits input on Enter (\\n)", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("world"));
    dataHandler!(Buffer.from("\n"));

    const result = await promise;
    expect(result).toBe("world");
  });

  test("inserts newline on Shift+Enter (CSI-u sequence)", async () => {
    const promise = readMultiLine();

    // Type "line1", then Shift+Enter (ESC[27;2;13~), then "line2", then Enter
    dataHandler!(Buffer.from("line1"));
    dataHandler!(Buffer.from("\x1b[27;2;13~")); // Shift+Enter
    dataHandler!(Buffer.from("line2"));
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("line1\nline2");
    // Should show continuation prompt
    expect(writes.some((w) => w.includes("..."))).toBe(true);
  });

  test("inserts newline on Alt+Enter (CSI-u sequence)", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("a"));
    dataHandler!(Buffer.from("\x1b[27;3;13~")); // Alt+Enter
    dataHandler!(Buffer.from("b"));
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("a\nb");
  });

  test("throws ERR_USE_AFTER_CLOSE on Ctrl+C (ETX)", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("typing"));
    dataHandler!(Buffer.from("\x03")); // Ctrl+C

    await expect(promise).rejects.toMatchObject({
      code: "ERR_USE_AFTER_CLOSE",
    });
    expect(mockSetRawMode).toHaveBeenCalledWith(false);
  });

  test("throws ERR_USE_AFTER_CLOSE on Ctrl+D (EOT) when empty", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("\x04")); // Ctrl+D with no input

    await expect(promise).rejects.toMatchObject({
      code: "ERR_USE_AFTER_CLOSE",
    });
  });

  test("ignores Ctrl+D when input is not empty", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("content"));
    dataHandler!(Buffer.from("\x04")); // Ctrl+D - should be ignored
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("content");
  });

  test("handles backspace (code 8)", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("ab"));
    dataHandler!(Buffer.from("\x08")); // Backspace
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("a");
  });

  test("handles backspace (code 127 DEL)", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("xyz"));
    dataHandler!(Buffer.from("\x7f")); // DEL
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("xy");
  });

  test("handles backspace at line start by merging with previous line", async () => {
    const promise = readMultiLine();

    // Type "first", press Shift+Enter to open an empty new line, then
    // immediately press Backspace at the start of that empty line — the
    // merge brings the cursor back to the end of "first". Subsequent
    // typing then appends to the merged line.
    dataHandler!(Buffer.from("first"));
    dataHandler!(Buffer.from("\x1b[27;2;13~")); // Shift+Enter
    dataHandler!(Buffer.from("\x08")); // Backspace at cursor=0 of new empty line
    dataHandler!(Buffer.from("second"));
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("firstsecond");
  });

  test("ignores unknown escape sequences", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("test"));
    dataHandler!(Buffer.from("\x1b[A")); // Up arrow - ignored
    dataHandler!(Buffer.from("\x1b[B")); // Down arrow - ignored
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("test");
  });

  test("ignores unknown CSI-u sequences", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("test"));
    dataHandler!(Buffer.from("\x1b[27;5;13~")); // Ctrl+Enter (not handled) - ignored
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("test");
  });

  test("handles multiple lines with Shift+Enter", async () => {
    const promise = readMultiLine();

    dataHandler!(Buffer.from("a"));
    dataHandler!(Buffer.from("\x1b[27;2;13~"));
    dataHandler!(Buffer.from("b"));
    dataHandler!(Buffer.from("\x1b[27;2;13~"));
    dataHandler!(Buffer.from("c"));
    dataHandler!(Buffer.from("\r"));

    const result = await promise;
    expect(result).toBe("a\nb\nc");
  });
});
