import { resolve as resolvePath } from "node:path";
import { findInFiles, Lang, parse, type SgNode } from "@ast-grep/napi";
import { tool } from "ai";
import { Bash, OverlayFs } from "just-bash";
import { z } from "zod";

const LANG_NAMES = ["JavaScript", "TypeScript", "Tsx", "Html", "Css"] as const;
type LangName = (typeof LANG_NAMES)[number];

interface AstGrepMatch {
  file: string;
  text: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

function formatMatch(file: string, node: SgNode): AstGrepMatch {
  const range = node.range();
  return {
    file,
    text: node.text(),
    range: {
      start: { line: range.start.line, column: range.start.column },
      end: { line: range.end.line, column: range.end.column },
    },
  };
}

export interface CreateToolsOptions {
  /** Root directory exposed to the bash tool via OverlayFs. Defaults to process.cwd(). */
  cwd?: string;
}

export function createTools(opts: CreateToolsOptions = {}) {
  const root = opts.cwd ?? process.cwd();
  const overlay = new OverlayFs({ root });
  const bashEnv = new Bash({ fs: overlay, cwd: overlay.getMountPoint() });

  return {
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

    astGrep: tool({
      description:
        "Structural code search using ast-grep AST patterns (e.g. 'console.log($A)'). Provide either `source` to search a string, or `paths` to recursively search files under cwd. Returns matches with file, text, and range.",
      inputSchema: z.object({
        pattern: z.string().describe("ast-grep pattern, e.g. 'console.log($ARG)'."),
        language: z.enum(LANG_NAMES).describe("Source language for parsing."),
        source: z
          .string()
          .optional()
          .describe("Source string to search. Mutually exclusive with `paths`."),
        paths: z
          .array(z.string())
          .optional()
          .describe(
            "Paths (relative to cwd) to search recursively. Mutually exclusive with `source`.",
          ),
      }),
      execute: async ({ pattern, language, source, paths }) => {
        const haveSource = source !== undefined;
        const havePaths = paths !== undefined;
        if (haveSource === havePaths) {
          throw new Error("astGrep: provide exactly one of `source` or `paths`.");
        }

        const lang = Lang[language as LangName];

        if (haveSource) {
          const root = parse(lang, source!).root();
          const matches = root.findAll(pattern).map((n) => formatMatch("<source>", n));
          return { matches };
        }

        const resolvedPaths = paths!.map((p) => resolvePath(root, p));
        const collected: AstGrepMatch[] = [];
        await findInFiles(
          lang,
          { paths: resolvedPaths, matcher: { rule: { pattern } } },
          (err, nodes) => {
            if (err) throw err;
            for (const n of nodes) {
              collected.push(formatMatch(n.getRoot().filename(), n));
            }
          },
        );
        return { matches: collected };
      },
    }),
  };
}
