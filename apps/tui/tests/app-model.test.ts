import { describe, expect, test } from "vite-plus/test";
import { ApprovalQueue } from "@smoovcode/ui-core";
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

  test("approval prompt resolves host requests", async () => {
    const queue = new ApprovalQueue<{ argv: string[] }>();
    const model = new TuiAppModel({ banner: "banner", approvalQueue: queue });
    const approval = queue.enqueue({ argv: ["npm", "test"] });

    expect(model.renderLines().join("\n")).toContain("Approve host command");
    model.approvePending(true);

    await expect(approval).resolves.toBe(true);
  });
});
