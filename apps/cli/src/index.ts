#!/usr/bin/env node
import { runLoop } from "./loop.ts";
import { pickExecutor } from "./pick-executor.ts";

const backend = process.env.SMOOV_BACKEND ?? "local";
const model = process.env.SMOOV_MODEL;
await runLoop(pickExecutor(backend), model);
