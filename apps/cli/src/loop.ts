import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";
import { Agent, type Executor } from "@smoovcode/agent";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function runLoop(executor: Executor, model?: string) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const agent = new Agent({ executor, model });

  stdout.write(`smoovcode (backend: ${executor.name}) — ctrl-d to exit\n`);

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
