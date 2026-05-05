import { describe, expect, test } from "vite-plus/test";
import { contextWindowForModel, formatStatusLine } from "../src/status-line.ts";

const ESC = "\u001b[";
const ansiPattern = new RegExp(`${ESC.replace("[", "\\[")}[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

describe("contextWindowForModel", () => {
  test("finds known models after provider prefixes", () => {
    expect(contextWindowForModel("openai/gpt-5")).toBe(contextWindowForModel("gpt-5"));
    expect(contextWindowForModel("unknown/model")).toBeUndefined();
  });
});

describe("formatStatusLine", () => {
  test("formats project, branch, short model, revision, tokens, and context availability", () => {
    const line = formatStatusLine({
      cwd: "/tmp/smoovcode",
      branch: "main",
      model: "openai/gpt-test",
      revision: "abc12345",
      inputTokens: 12_300,
      outputTokens: 456,
      contextWindow: 100_000,
      effort: "medium",
    });

    expect(stripAnsi(line)).toBe(
      "smoovcode on main\n[gpt-test] abc12345 ↑12.3k ↓456 12% used/88% avail/100k ctx • medium",
    );
    expect(line).toContain(`${ESC}34msmoovcode${ESC}39m`);
    expect(line).toContain(`${ESC}35m on ${ESC}39m${ESC}1m${ESC}35mmain${ESC}39m${ESC}22m`);
    expect(line).toContain(`${ESC}36m[gpt-test]${ESC}39m`);
    expect(line).toContain(`${ESC}2m abc12345${ESC}22m`);
    expect(line).toContain(`${ESC}32m 12% used/88% avail/100k ctx${ESC}39m`);
  });

  test("omits context when no context window is available", () => {
    const line = formatStatusLine({
      cwd: "/tmp/smoovcode",
      branch: "main",
      model: "provider/custom-model",
      inputTokens: 1000,
      outputTokens: 20,
    });

    expect(stripAnsi(line)).toBe("smoovcode on main\n[custom-model] ↑1k ↓20");
  });
});
