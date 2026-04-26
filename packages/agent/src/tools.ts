import { tool } from "ai";
import { z } from "zod";

export const tools = {
  echo: tool({
    description: "Echo a string back. Useful for testing.",
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => ({ echoed: text }),
  }),
  add: tool({
    description: "Add two numbers.",
    inputSchema: z.object({ a: z.number(), b: z.number() }),
    execute: async ({ a, b }) => ({ sum: a + b }),
  }),
};
