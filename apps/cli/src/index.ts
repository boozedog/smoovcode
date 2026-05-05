#!/usr/bin/env node
import { parseCliOptions } from "./cli-options.ts";
import { runLoop } from "./loop.ts";
import { pickExecutor } from "./pick-executor.ts";

const options = parseCliOptions(process.argv.slice(2));
const backend = process.env.SMOOV_BACKEND ?? "quickjs";
const model = process.env.SMOOV_MODEL;
await runLoop(pickExecutor(backend), model, options);
