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
});
