import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";
import {
  Agent,
  type Executor,
  findProjectRoot,
  type HostApprovalRequest,
  type HostApprover,
} from "@smoovcode/agent";
import {
  ApprovalQueue,
  type ConversationEvent,
  type ConversationState,
  initialConversation,
  reduceConversation,
} from "@smoovcode/ui-core";

const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

interface RenderState {
  conversation: ConversationState;
  inReasoning: boolean;
}

function renderEvent(
  state: RenderState,
  event: ConversationEvent,
): { write: string; next: RenderState } {
  const conversation = reduceConversation(state.conversation, event);
  let write = "";
  let inReasoning = state.inReasoning;
  if (inReasoning && event.type !== "reasoning") {
    write += `${RESET}\n`;
    inReasoning = false;
  }
  switch (event.type) {
    case "text":
      write += event.delta;
      break;
    case "reasoning":
      if (!inReasoning) {
        write += `${DIM}thinking: `;
        inReasoning = true;
      }
      write += event.delta;
      break;
    case "tool-call":
      write += `\n[${event.name}] ${JSON.stringify(event.input)}\n`;
      break;
    case "tool-result": {
      const o = event.output;
      const compact =
        o && typeof o === "object" && "result" in o ? (o as { result: unknown }).result : o;
      write += `[${event.name}] → ${JSON.stringify(compact)}\n`;
      break;
    }
    case "tool-error":
      write += `[${event.name}] ✗ ${event.error}\n`;
      break;
    case "error":
      write += `\n[error] ${event.error}\n`;
      break;
    case "turn-start":
    case "turn-end":
      break;
  }
  return { write, next: { conversation, inReasoning } };
}

export async function runLoop(executor: Executor, model?: string) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const projectRoot = findProjectRoot(process.cwd());

  const approvalQueue = new ApprovalQueue<HostApprovalRequest>();
  const approveHost: HostApprover = (req) => approvalQueue.enqueue(req);

  let pumping = false;
  approvalQueue.subscribe(() => {
    if (pumping) return;
    pumping = true;
    void (async () => {
      try {
        let req: HostApprovalRequest | null;
        while ((req = approvalQueue.peek())) {
          const display = req.argv
            .map((a) => (/[^A-Za-z0-9_./-]/.test(a) ? JSON.stringify(a) : a))
            .join(" ");
          stdout.write(`\n${YELLOW}host execution requested:${RESET} ${display}\n`);
          if (req.reason) stdout.write(`${DIM}reason: ${req.reason}${RESET}\n`);
          const answer = (await rl.question("approve? [y/N] ")).trim().toLowerCase();
          approvalQueue.resolve(answer === "y" || answer === "yes");
        }
      } finally {
        pumping = false;
      }
    })();
  });

  const agent = new Agent({ executor, model, cwd: projectRoot, approveHost });

  stdout.write(`smoovcode (backend: ${executor.name}, root: ${projectRoot}) — ctrl-d to exit\n`);

  let render: RenderState = { conversation: initialConversation, inReasoning: false };

  try {
    while (true) {
      const msg = await rl.question("\n> ");
      if (!msg.trim()) continue;

      const started = renderEvent(render, { type: "turn-start", userMessage: msg });
      render = started.next;
      if (started.write) stdout.write(started.write);

      try {
        for await (const event of agent.run(msg)) {
          const step = renderEvent(render, event);
          render = step.next;
          if (step.write) stdout.write(step.write);
        }
        const ended = renderEvent(render, { type: "turn-end" });
        render = ended.next;
        if (ended.write) stdout.write(ended.write);
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
