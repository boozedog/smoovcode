import { describe, expect, test } from "vite-plus/test";
import { parseCliOptions } from "../src/cli-options.ts";

describe("parseCliOptions", () => {
  test("defaults verbose off", () => {
    expect(parseCliOptions([])).toEqual({ verbose: false });
  });

  test("accepts --verbose", () => {
    expect(parseCliOptions(["--verbose"])).toEqual({ verbose: true });
  });

  test("accepts SMOOV_VERBOSE=true", () => {
    expect(parseCliOptions([], { SMOOV_VERBOSE: "true" })).toEqual({ verbose: true });
  });

  test("accepts SMOOV_VERBOSE=1", () => {
    expect(parseCliOptions([], { SMOOV_VERBOSE: "1" })).toEqual({ verbose: true });
  });
});
