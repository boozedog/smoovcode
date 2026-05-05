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

  test("ctrl-o toggles live codemode blocks", () => {
    const model = new TuiAppModel({ banner: "banner" });
    model.setLiveBlocks(
      [
        {
          kind: "tool-call",
          id: "live-code",
          name: "codemode",
          input: { code: "return 'live'" },
          status: "done",
          output: { result: "ok" },
        },
      ],
      1,
    );

    model.toggleCodemodeExpansion();

    expect(model.renderLines().join("\n")).toContain("return 'live'");
  });

  test("codemode expansion survives live to finalized transition", () => {
    const model = new TuiAppModel({ banner: "banner" });
    const block = {
      kind: "tool-call" as const,
      id: "same-code",
      name: "codemode",
      input: { code: "return 'same'" },
      status: "done" as const,
      output: { result: "ok" },
    };
    model.setLiveBlocks([block], 1);
    model.toggleCodemodeExpansion();

    model.addBlock(block, `b-1-${block.id}`);
    model.finishTurn();

    expect(model.renderLines().join("\n")).toContain("return 'same'");
  });

  test("stale expansion ids do not confuse toggle-all", () => {
    const model = new TuiAppModel({ banner: "banner" });
    model.expandedCodemodeIds.add("stale");
    model.addBlock({
      kind: "tool-call",
      id: "current",
      name: "codemode",
      input: { code: "return 'current'" },
      status: "done",
    });

    model.toggleCodemodeExpansion();

    expect(model.renderLines().join("\n")).toContain("return 'current'");
  });

  test("ctrl-r toggles all reasoning transcript blocks", () => {
    const model = new TuiAppModel({ banner: "banner" });
    model.addBlock({ kind: "reasoning", id: "r1", text: "hidden thought", status: "done" });

    expect(model.renderLines().join("\n")).not.toContain("hidden thought");

    model.toggleReasoningExpansion();
    expect(model.renderLines().join("\n")).toContain("hidden thought");

    model.toggleReasoningExpansion();
    expect(model.renderLines().join("\n")).not.toContain("hidden thought");
  });

  test("ctrl-r toggles live reasoning blocks", () => {
    const model = new TuiAppModel({ banner: "banner" });
    model.setLiveBlocks(
      [{ kind: "reasoning", id: "live-r", text: "live thought", status: "done" }],
      1,
    );

    model.toggleReasoningExpansion();

    expect(model.renderLines().join("\n")).toContain("live thought");
  });
});
