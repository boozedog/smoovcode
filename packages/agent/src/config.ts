import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const ArgvPrefix = z
  .array(z.string().min(1))
  .min(1, "host.allow entries must be non-empty argv prefixes");

const ConfigSchema = z
  .object({
    host: z.object({ allow: z.array(ArgvPrefix).default([]) }).default({ allow: [] }),
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
 * for user-private overrides (gitignored) — its allow/deny entries are appended
 * to the project file's, never replacing them, so a user can grant themselves
 * extra capability without changing the committed config.
 */
export function loadSmoovConfig(opts: LoadSmoovConfigOptions): SmoovConfig {
  const baseFile = join(opts.root, ".smoov", "config.json");
  const localFile = join(opts.root, ".smoov", "config.local.json");

  const base = readConfigFile(baseFile);
  const local = readConfigFile(localFile);

  return {
    host: { allow: [...base.host.allow, ...local.host.allow] },
    secrets: { deny: [...base.secrets.deny, ...local.secrets.deny] },
  };
}

function readConfigFile(path: string): SmoovConfig {
  if (!existsSync(path)) return { host: { allow: [] }, secrets: { deny: [] } };
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

/**
 * Returns true when `argv` begins with any prefix in `prefixes`. Used by the
 * dispatcher to decide whether a host-target argv has been explicitly allowed.
 */
export function matchesAllowPrefix(
  argv: readonly string[],
  prefixes: ReadonlyArray<readonly string[]>,
): boolean {
  for (const prefix of prefixes) {
    if (prefix.length === 0 || argv.length < prefix.length) continue;
    let ok = true;
    for (let i = 0; i < prefix.length; i++) {
      if (argv[i] !== prefix[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
