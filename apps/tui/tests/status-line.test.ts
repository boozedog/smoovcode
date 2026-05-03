import { describe, expect, test } from "vite-plus/test";
import { formatStatusLine } from "../src/status-line.ts";

const ESC = "\u001b[";
const ansiPattern = new RegExp(`${ESC.replace("[", "\\[")}[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

describe("formatStatusLine", () => {
  test("formats project, branch, model, revision, and context", () => {
    const line = formatStatusLine({
      cwd: "/tmp/smoovcode",
      branch: "main",
      model: "gpt-test",
      revision: "abc12345",
      contextPercent: 42,
    });

    expect(stripAnsi(line)).toBe("smoovcode on main\n[gpt-test] abc12345 42%");
    expect(line).toContain(`${ESC}34msmoovcode${ESC}39m`);
    expect(line).toContain(`${ESC}35m on ${ESC}39m${ESC}1m${ESC}35mmain${ESC}39m${ESC}22m`);
    expect(line).toContain(`${ESC}36m[gpt-test]${ESC}39m`);
    expect(line).toContain(`${ESC}2m abc12345${ESC}22m`);
    expect(line).toContain(`${ESC}32m 42%${ESC}39m`);
  });
});
