import { describe, expect, test } from "vite-plus/test";
import { renderHeader } from "../src/header.ts";

const ESC = String.fromCharCode(27);
const ansiPattern = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

describe("renderHeader", () => {
  test("renders a compact logo with dim informational lines", () => {
    const lines = renderHeader({ backend: "quickjs", root: "/tmp/smoovcode", model: "gpt-5" });

    expect(lines.map(stripAnsi)).toEqual([
      ` ___ _ __ ___   ___   _____   _____ ___   __| | ___`,
      `/ __| '_ \` _ \\ / _ \\ / _ \\ \\ / / __/ _ \\ / _\` |/ _ \\`,
      `\\__ \\ | | | | | (_) | (_) \\ V / (_| (_) | (_| |  __/`,
      `|___/_| |_| |_|\\___/ \\___/ \\_/ \\___\\___/ \\__,_|\\___|`,
      "",
      "backend  quickjs",
      "root     /tmp/smoovcode",
      "model    gpt-5",
      "keys     ctrl-c exit · ctrl-o expand codemode · ctrl-r expand thinking",
    ]);
    expect(lines[5]).toContain("\u001b[2m");
  });
});
