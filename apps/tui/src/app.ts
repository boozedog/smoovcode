import { AgentRunner, type AgentLike } from "./agent-runner.ts";
import { TuiAppModel } from "./app-model.ts";
import {
  isEncodedKeySequence,
  isModifiedEnterSequence,
  parseKey,
  type KeyInput,
} from "./prompt-model.ts";
import { TerminalRenderer, type Terminal } from "./renderer.ts";
import type { SessionStats } from "./status-line.ts";

const KEYBOARD_PROTOCOL_ENABLE = "\u001b[>1u\u001b[>4;2m";
const KEYBOARD_PROTOCOL_DISABLE = "\u001b[<1u\u001b[>4;0m";

export interface TuiAppOptions {
  agent: AgentLike;
  banner: string | string[];
  stats?: SessionStats;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

export class TuiApp {
  readonly model: TuiAppModel;
  private readonly renderer: TerminalRenderer;
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private running = false;
  private startedAt = Date.now();
  private spinnerTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: TuiAppOptions) {
    this.stdin = opts.stdin ?? process.stdin;
    this.stdout = opts.stdout ?? process.stdout;
    this.model = new TuiAppModel({
      banner: opts.banner,
      stats: opts.stats,
    });
    this.renderer = new TerminalRenderer(toTerminal(this.stdout));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stdin.setEncoding("utf8");
    if (this.stdin.isTTY) this.stdin.setRawMode(true);
    if (this.stdout.isTTY) this.stdout.write(KEYBOARD_PROTOCOL_ENABLE);
    this.stdin.resume();
    this.stdin.on("data", this.onData);
    this.stdout.on("resize", this.onResize);
    process.on("SIGWINCH", this.onResize);
    this.render();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stdin.off("data", this.onData);
    this.stdout.off("resize", this.onResize);
    process.off("SIGWINCH", this.onResize);
    if (this.stdin.isTTY) this.stdin.setRawMode(false);
    if (this.stdout.isTTY) this.stdout.write(KEYBOARD_PROTOCOL_DISABLE);
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
  }

  private readonly render = (): void => {
    const frame = this.model.renderFrame(Date.now(), this.startedAt);
    this.renderer.render(frame.lines, { cursor: frame.cursor });
  };

  private readonly onResize = (): void => {
    if (!this.running) return;
    const frame = this.model.renderFrame(Date.now(), this.startedAt);
    this.renderer.render(frame.lines, { cursor: frame.cursor });
  };

  private readonly onData = (chunk: Buffer | string): void => {
    for (const key of parseInput(chunk.toString())) this.handleKey(key);
    this.render();
  };

  private handleKey(key: KeyInput): void {
    if (key.ctrl && key.name === "c") {
      this.exit(0);
      return;
    }
    if (key.ctrl && key.name === "o") {
      this.model.toggleCodemodeExpansion();
      return;
    }
    if (key.ctrl && key.name === "r") {
      this.model.toggleReasoningExpansion();
      return;
    }
    if (this.model.pendingMessage === null) {
      this.model.prompt.handleKey(key, (message) => this.submit(message));
    }
  }

  private submit(message: string): void {
    this.model.submit(message);
    this.startedAt = Date.now();
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = setInterval(this.render, 250);
    const runner = new AgentRunner(this.opts.agent, message, {
      onBlockFinalize: (block, turnId) => this.model.addBlock(block, `b-${turnId}-${block.id}`),
      onLiveTextChange: (blocks, turnId) => this.model.setLiveBlocks(blocks, turnId),
      onUsage: (usage) => this.model.addUsage(usage),
      onDone: () => {
        this.model.finishTurn();
        if (this.spinnerTimer) clearInterval(this.spinnerTimer);
        this.spinnerTimer = null;
      },
      onError: (err) => {
        this.model.addError(err);
        if (this.spinnerTimer) clearInterval(this.spinnerTimer);
        this.spinnerTimer = null;
      },
      onRender: this.render,
    });
    void runner.start();
  }

  private exit(code: number): void {
    this.stop();
    process.exit(code);
  }
}

export function parseInput(input: string): KeyInput[] {
  const keys: KeyInput[] = [];
  for (let idx = 0; idx < input.length; idx += 1) {
    const char = input[idx];
    if (char === "\u001b") {
      const rest = input.slice(idx);
      const encodedKey = readEncodedKey(rest);
      const modifiedEnter = readModifiedEnter(rest);
      if (encodedKey) {
        keys.push(parseKey(encodedKey));
        idx += encodedKey.length - 1;
      } else if (modifiedEnter) {
        keys.push(parseKey(modifiedEnter));
        idx += modifiedEnter.length - 1;
      } else if (rest.startsWith("\u001b[A")) {
        keys.push({ sequence: "\u001b[A", name: "up" });
        idx += 2;
      } else if (rest.startsWith("\u001b[B")) {
        keys.push({ sequence: "\u001b[B", name: "down" });
        idx += 2;
      } else if (rest.startsWith("\u001b[C")) {
        keys.push({ sequence: "\u001b[C", name: "right" });
        idx += 2;
      } else if (rest.startsWith("\u001b[D")) {
        keys.push({ sequence: "\u001b[D", name: "left" });
        idx += 2;
      } else {
        keys.push({ sequence: char, name: "escape" });
      }
    } else if (char === "\u000f") keys.push({ sequence: char, name: "o", ctrl: true });
    else if (char === "\u0003") keys.push({ sequence: char, name: "c", ctrl: true });
    else if (char === "\r" || char === "\n") keys.push({ sequence: char, name: "enter" });
    else if (char === "\u007f" || char === "\b") keys.push({ sequence: char, name: "backspace" });
    else keys.push(parseKey(char));
  }
  return keys;
}

function readEncodedKey(input: string): string | null {
  const escape = String.fromCharCode(27);
  const match = new RegExp(`^${escape}\\[(?:\\d+;\\d+u|27;\\d+;\\d+~)`).exec(input);
  if (!match) return null;
  const candidate = match[0];
  return isEncodedKeySequence(candidate) ? candidate : null;
}

function readModifiedEnter(input: string): string | null {
  for (const candidate of ["\u001b[13;2u", "\u001b[13;3u", "\u001b[27;2;13~", "\u001b[27;3;13~"]) {
    if (input.startsWith(candidate) && isModifiedEnterSequence(candidate)) return candidate;
  }
  return null;
}

function toTerminal(stdout: NodeJS.WriteStream): Terminal {
  return {
    get rows() {
      return stdout.rows ?? 24;
    },
    get cols() {
      return stdout.columns ?? 80;
    },
    isTTY: stdout.isTTY === true,
    write: (chunk) => stdout.write(chunk),
  };
}
