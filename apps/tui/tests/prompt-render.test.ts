import { describe, expect, test } from "vite-plus/test";
import { PromptModel, parseKey } from "../src/prompt-model.ts";

describe("PromptModel rendering", () => {
  test("renders an active bright green software cursor at the prompt end", () => {
    const prompt = new PromptModel();
    prompt.handleKey(parseKey("x"), () => undefined);

    expect(prompt.renderLines({ focused: true, cursorVisible: true })).toEqual([
      "> x\u001b[92m█\u001b[39m",
    ]);
  });

  test("renders a same-size hollow non-blinking cursor when unfocused", () => {
    const prompt = new PromptModel();

    expect(prompt.renderLines({ focused: false, cursorVisible: false })).toEqual([
      "> \u001b[92m░\u001b[39m",
    ]);
  });

  test("renders the software cursor on the final logical line of multiline prompts", () => {
    const prompt = new PromptModel();
    prompt.handleKey(parseKey("a"), () => undefined);
    prompt.handleKey({ name: "enter", sequence: "\r", shift: true }, () => undefined);
    prompt.handleKey(parseKey("b"), () => undefined);

    expect(prompt.renderLines({ focused: true, cursorVisible: true })).toEqual([
      "> a",
      "... b\u001b[92m█\u001b[39m",
    ]);
  });
});
