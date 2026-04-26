import { expect, test } from "vite-plus/test";
import type { ResolvedProvider } from "../src/executor.ts";
import { LocalExecutor } from "../src/executors/local.ts";
import { QuickJSExecutor } from "../src/executors/quickjs.ts";

const providers: ResolvedProvider[] = [
  {
    name: "codemode",
    fns: {
      echo: async (args: unknown) => ({
        echoed: (args as { text: string }).text,
      }),
      add: async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return { sum: a + b };
      },
    },
  },
];

const code = `async () => {
  const e = await codemode.echo({ text: "hello" });
  const s = await codemode.add({ a: 2, b: 3 });
  return { e, s };
}`;

test("LocalExecutor runs codemode-style code", async () => {
  const r = await new LocalExecutor().execute(code, providers);
  expect(r.error).toBeUndefined();
  expect(r.result).toEqual({ e: { echoed: "hello" }, s: { sum: 5 } });
});

test("QuickJSExecutor runs codemode-style code", async () => {
  const r = await new QuickJSExecutor().execute(code, providers);
  expect(r.error).toBeUndefined();
  expect(r.result).toEqual({ e: { echoed: "hello" }, s: { sum: 5 } });
});
