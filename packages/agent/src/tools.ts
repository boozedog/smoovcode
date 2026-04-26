import { tool } from "ai";
import { Bash, OverlayFs } from "just-bash";
import { z } from "zod";

export interface CreateToolsOptions {
  /** Root directory exposed to the bash tool via OverlayFs. Defaults to process.cwd(). */
  cwd?: string;
}

export function createTools(opts: CreateToolsOptions = {}) {
  const root = opts.cwd ?? process.cwd();
  const overlay = new OverlayFs({ root });
  const bashEnv = new Bash({ fs: overlay, cwd: overlay.getMountPoint() });

  return {
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
    bash: tool({
      description:
        "Run a bash script in a sandboxed shell. Reads come from the project directory; writes stay in memory and never touch disk.",
      inputSchema: z.object({
        script: z.string().describe("Bash script to execute."),
        stdin: z.string().optional().describe("Standard input to pass to the script."),
      }),
      execute: async ({ script, stdin }) => {
        const result = await bashEnv.exec(script, stdin !== undefined ? { stdin } : undefined);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      },
    }),
  };
}
