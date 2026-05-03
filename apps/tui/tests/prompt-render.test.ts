import { describe, expect, test } from "vite-plus/test";
import { PromptModel, parseKey } from "../src/prompt-model.ts";

describe("PromptModel rendering", () => {
  test("does not render a fake cursor", () => {
    const prompt = new PromptModel();
    prompt.handleKey(parseKey("x"), () => undefined);

    expect(prompt.renderLines()).toEqual(["> x"]);
  });
});
