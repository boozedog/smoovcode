import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { TuiApp } from "../src/app.ts";

class FakeInput extends EventEmitter {
  isTTY = true;
  encoding = "";
  rawMode = false;

  setEncoding(encoding: BufferEncoding): void {
    this.encoding = encoding;
  }

  setRawMode(value: boolean): void {
    this.rawMode = value;
  }

  resume(): void {}
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  rows = 5;
  columns = 80;
  output = "";

  write(chunk: string): boolean {
    this.output += chunk;
    return true;
  }

  clearOutput(): void {
    this.output = "";
  }
}

const agent = {
  async *run() {},
};

afterEach(() => {
  vi.useRealTimers();
});

describe("TuiApp resize handling", () => {
  test("hides native cursor and enables focus reporting while running, then restores cleanup", () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    const app = new TuiApp({
      agent,
      banner: "banner",
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    });

    app.start();
    expect(stdout.output).toContain("\u001b[?25l");
    expect(stdout.output).toContain("\u001b[?1004h");

    stdout.clearOutput();
    app.stop();

    expect(stdout.output).toContain("\u001b[?1004l");
    expect(stdout.output).toContain("\u001b[?25h");
  });

  test("keeps the cursor visible and pauses blinking while typing", () => {
    vi.useFakeTimers();
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    const app = new TuiApp({
      agent,
      banner: "banner",
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    });

    app.start();
    stdout.clearOutput();
    stdin.emit("data", "x");
    expect(stdout.output).toContain("\u001b[92m█\u001b[39m");

    stdout.clearOutput();
    vi.advanceTimersByTime(500);

    expect(stdout.output).toBe("");

    vi.advanceTimersByTime(249);

    expect(stdout.output).toBe("");
    vi.advanceTimersByTime(250);

    expect(stdout.output).toContain("> x");
    app.stop();
  });

  test("clears and redraws when stdout emits resize", () => {
    const stdin = new FakeInput();
    const stdout = new FakeOutput();
    const app = new TuiApp({
      agent,
      banner: "banner",
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    });

    app.start();
    stdout.clearOutput();
    stdout.columns = 20;
    stdout.rows = 3;
    stdout.emit("resize");
    app.stop();

    expect(stdout.output).toContain("\u001b[H\u001b[0J");
    expect(stdout.output).toContain("banner");
  });
});
