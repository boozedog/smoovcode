import { describe, expect, test } from "vite-plus/test";
import { formatStatusLine } from "../src/status-line.ts";

describe("formatStatusLine", () => {
  test("formats project, branch, model, revision, and context", () => {
    expect(
      formatStatusLine({
        cwd: "/tmp/smoovcode",
        branch: "main",
        model: "gpt-test",
        revision: "abc12345",
        contextPercent: 42,
      }),
    ).toBe("smoovcode on main\n[gpt-test] abc12345 42%");
  });
});
