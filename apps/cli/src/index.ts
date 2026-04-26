#!/usr/bin/env node
import {
  CloudflareExecutor,
  type Executor,
  LocalExecutor,
  QuickJSExecutor,
} from "@smoovcode/agent";
import { runLoop } from "./loop.ts";

function pickExecutor(name: string): Executor {
  switch (name) {
    case "local":
      return new LocalExecutor();
    case "quickjs":
      return new QuickJSExecutor();
    case "cloudflare":
      return new CloudflareExecutor();
    default:
      throw new Error(`unknown backend: ${name}`);
  }
}

const backend = process.env.SMOOV_BACKEND ?? "local";
const model = process.env.SMOOV_MODEL;
await runLoop(pickExecutor(backend), model);
