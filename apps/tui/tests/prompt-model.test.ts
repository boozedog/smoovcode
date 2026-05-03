import { describe, expect, test } from "vite-plus/test";
import { PromptModel, parseKey } from "../src/prompt-model.ts";

describe("PromptModel", () => {
  test("edits multiline input and submits trimmed text", () => {
    const prompt = new PromptModel();
    const submitted: string[] = [];

    prompt.handleKey(parseKey("h"), (text) => submitted.push(text));
    prompt.handleKey(parseKey("i"), (text) => submitted.push(text));
    prompt.handleKey({ name: "enter", shift: true }, (text) => submitted.push(text));
    prompt.handleKey(parseKey("!"), (text) => submitted.push(text));
    prompt.handleKey({ name: "enter" }, (text) => submitted.push(text));

    expect(submitted).toEqual(["hi\n!"]);
    expect(prompt.lines).toEqual([""]);
  });

  test("ignores control/navigation keys", () => {
    const prompt = new PromptModel();

    prompt.handleKey({ sequence: "c", ctrl: true }, () => undefined);
    prompt.handleKey({ name: "up" }, () => undefined);

    expect(prompt.lines).toEqual([""]);
  });
});
