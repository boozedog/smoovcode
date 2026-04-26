import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";
import { Agent, type Executor, type HostApprover } from "@smoovcode/agent";

const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * Walk up from `start` to find the nearest ancestor that looks like a project
 * root (contains `.smoov/` or `.git/`). The agent uses this as the OverlayFs
 * root so the sandbox covers the whole repo rather than just the CLI cwd.
 */
function findProjectRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, ".smoov")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export async function runLoop(executor: Executor, model?: string) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const projectRoot = findProjectRoot(process.cwd());

  const approveHost: HostApprover = async ({ argv, reason }) => {
    const display = argv.map((a) => (/[^A-Za-z0-9_./-]/.test(a) ? JSON.stringify(a) : a)).join(" ");
    stdout.write(`\n${YELLOW}host execution requested:${RESET} ${display}\n`);
    if (reason) stdout.write(`${DIM}reason: ${reason}${RESET}\n`);
    const answer = (await rl.question("approve? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  };

  const agent = new Agent({ executor, model, cwd: projectRoot, approveHost });

  stdout.write(`smoovcode (backend: ${executor.name}, root: ${projectRoot}) — ctrl-d to exit\n`);

  try {
    while (true) {
      const msg = await rl.question("\n> ");
      if (!msg.trim()) continue;

      try {
        let inReasoning = false;
        for await (const event of agent.run(msg)) {
          if (inReasoning && event.type !== "reasoning") {
            stdout.write(`${RESET}\n`);
            inReasoning = false;
          }
          switch (event.type) {
            case "text":
              stdout.write(event.delta);
              break;
            case "reasoning":
              if (!inReasoning) {
                stdout.write(`${DIM}thinking: `);
                inReasoning = true;
              }
              stdout.write(event.delta);
              break;
            case "tool-call":
              stdout.write(`\n[${event.name}] ${JSON.stringify(event.input)}\n`);
              break;
            case "tool-result": {
              const o = event.output;
              const compact =
                o && typeof o === "object" && "result" in o ? (o as { result: unknown }).result : o;
              stdout.write(`[${event.name}] → ${JSON.stringify(compact)}\n`);
              break;
            }
            case "tool-error":
              stdout.write(`[${event.name}] ✗ ${event.error}\n`);
              break;
            case "error":
              stdout.write(`\n[error] ${event.error}\n`);
              break;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        stdout.write(`\n[error] ${errMsg}\n`);
      }
      stdout.write("\n");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") return;
    throw err;
  } finally {
    rl.close();
  }
}
