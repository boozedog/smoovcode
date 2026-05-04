import { describe, expect, test } from "vite-plus/test";
import { TuiAppModel } from "../src/app-model.ts";

describe("TuiAppModel", () => {
  test("ctrl-o toggles all codemode transcript blocks", () => {
    const model = new TuiAppModel({ banner: "banner" });
    model.addBlock({
      kind: "tool-call",
      id: "1",
      name: "codemode",
      input: { code: "return 1" },
      status: "done",
    });

    model.toggleCodemodeExpansion();
    expect(model.renderLines().join("\n")).toContain("return 1");

    model.toggleCodemodeExpansion();
    expect(model.renderLines().join("\n")).not.toContain("return 1");
  });
});
