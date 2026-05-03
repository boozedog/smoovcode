import { describe, expect, test } from "vite-plus/test";
import { parseInput } from "../src/app.ts";
import { PromptModel, parseKey } from "../src/prompt-model.ts";

describe("modified key input", () => {
  test("parses Kitty modified enter as a shifted enter key", () => {
    expect(parseInput("\u001b[13;2u")).toEqual([
      { sequence: "\u001b[13;2u", name: "enter", shift: true },
    ]);
  });

  test("parses xterm modified enter as a shifted enter key", () => {
    expect(parseInput("\u001b[27;2;13~")).toEqual([
      { sequence: "\u001b[27;2;13~", name: "enter", shift: true },
    ]);
  });

  test("parseKey accepts complete modified enter sequences", () => {
    expect(parseKey("\u001b[13;2u")).toEqual({
      sequence: "\u001b[13;2u",
      name: "enter",
      shift: true,
    });
  });

  test("parses CSI-u ctrl+o without leaking bytes into the prompt", () => {
    expect(parseInput("\u001b[111;5u")).toEqual([
      { sequence: "\u001b[111;5u", name: "o", ctrl: true },
    ]);
  });

  test("parses CSI-u ctrl+c", () => {
    expect(parseInput("\u001b[99;5u")).toEqual([
      { sequence: "\u001b[99;5u", name: "c", ctrl: true },
    ]);
  });

  test("parses xterm modifyOtherKeys ctrl+o without leaking bytes into the prompt", () => {
    expect(parseInput("\u001b[27;5;111~")).toEqual([
      { sequence: "\u001b[27;5;111~", name: "o", ctrl: true },
    ]);
  });

  test("parses xterm modifyOtherKeys ctrl+c", () => {
    expect(parseInput("\u001b[27;5;99~")).toEqual([
      { sequence: "\u001b[27;5;99~", name: "c", ctrl: true },
    ]);
  });

  test("modified enter inserts a new prompt line instead of submitting", () => {
    const prompt = new PromptModel();
    const submitted: string[] = [];

    for (const key of [parseKey("h"), parseInput("\u001b[13;2u")[0], parseKey("i")]) {
      prompt.handleKey(key, (message) => submitted.push(message));
    }

    expect(submitted).toEqual([]);
    expect(prompt.renderLines()).toEqual(["> h", "... i"]);
  });
});
