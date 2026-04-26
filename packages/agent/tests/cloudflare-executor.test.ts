import { describe, expect, test } from "vite-plus/test";
import { CloudflareExecutor } from "../src/executors/cloudflare.ts";

describe("CloudflareExecutor (stub)", () => {
  test("has the name 'cloudflare'", () => {
    expect(new CloudflareExecutor().name).toBe("cloudflare");
  });

  test("returns a not-implemented error from execute()", async () => {
    const r = await new CloudflareExecutor().execute("async () => 1", {});
    expect(r.result).toBeUndefined();
    expect(r.error).toMatch(/not implemented/i);
  });
});
