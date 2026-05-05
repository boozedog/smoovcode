import { describe, expect, test } from "vite-plus/test";
import { TuiAppModel } from "../src/app-model.ts";
import { parseKey } from "../src/prompt-model.ts";

const ESC = "\u001b[";
const ansiPattern = new RegExp(`${ESC.replace("[", "\\[")}[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

describe("TuiAppModel frame", () => {
  test("renders status under prompt while placing cursor on prompt", () => {
    const model = new TuiAppModel({
      banner: "banner",
      stats: { cwd: "/tmp/smoovcode", branch: "main", model: "model", revision: "rev" },
    });
    model.prompt.handleKey(parseKey("x"), () => undefined);

    const frame = model.renderFrame();

    expect(frame.lines.slice(-3).map(stripAnsi)).toEqual([
      "> x",
      "smoovcode on main",
      "[model] rev",
    ]);
    expect(frame.cursor).toEqual({ line: frame.lines.length - 3, column: 3 });
  });

  test("derives known model context when not explicitly provided", () => {
    const model = new TuiAppModel({
      banner: "banner",
      stats: { cwd: "/tmp/smoovcode", branch: "main", model: "openai/gpt-5" },
    });

    expect(stripAnsi(model.renderLines().at(-1) ?? "")).toBe("[gpt-5] 0% used/100% avail/400k ctx");
  });

  test("updates cumulative usage shown in the status line", () => {
    const model = new TuiAppModel({
      banner: "banner",
      stats: { cwd: "/tmp/smoovcode", branch: "main", model: "gpt-test", contextWindow: 10_000 },
    });

    model.addUsage({ inputTokens: 1000, outputTokens: 50 });
    model.addUsage({ inputTokens: 500, outputTokens: 25 });

    expect(stripAnsi(model.renderLines().at(-1) ?? "")).toBe(
      "[gpt-test] ↑1.5k ↓75 15% used/85% avail/10k ctx",
    );
  });
});
