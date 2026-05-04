import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const ConfigSchema = z
  .object({
    secrets: z.object({ deny: z.array(z.string().min(1)).default([]) }).default({ deny: [] }),
  })
  .strict();

export type SmoovConfig = z.infer<typeof ConfigSchema>;

export interface LoadSmoovConfigOptions {
  /** Project root containing the `.smoov` directory. */
  root: string;
}

/**
 * Read `.smoov/config.json` and (if present) merge in `.smoov/config.local.json`.
 *
 * Both files are validated against the same schema. The local file is meant
 * for user-private overrides (gitignored) — its deny entries are appended
 * to the project file's, never replacing them.
 */
export function loadSmoovConfig(opts: LoadSmoovConfigOptions): SmoovConfig {
  const baseFile = join(opts.root, ".smoov", "config.json");
  const localFile = join(opts.root, ".smoov", "config.local.json");

  const base = readConfigFile(baseFile);
  const local = readConfigFile(localFile);

  return {
    secrets: { deny: [...base.secrets.deny, ...local.secrets.deny] },
  };
}

function readConfigFile(path: string): SmoovConfig {
  if (!existsSync(path)) return { secrets: { deny: [] } };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`smoov config at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    throw new Error(`smoov config at ${path} is invalid${where}: ${issue.message}`);
  }
  return parsed.data;
}
