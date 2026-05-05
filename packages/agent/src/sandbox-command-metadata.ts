export type FlowEndpoint = "working-tree" | "stdin" | "stdout" | "network" | "unknown";

export type SandboxCommandPolicy = "allow" | "deny" | "requires-approval";

export interface SandboxCommandMetadata {
  command: string;
  description: string;
  flow?: {
    sources?: FlowEndpoint[];
    sinks?: FlowEndpoint[];
  };
  exposure: SandboxCommandPolicy;
  notes?: string;
}

const readWorkingTree = { sources: ["working-tree"], sinks: ["stdout"] } satisfies NonNullable<
  SandboxCommandMetadata["flow"]
>;
const transformStdin = { sources: ["stdin"], sinks: ["stdout"] } satisfies NonNullable<
  SandboxCommandMetadata["flow"]
>;
const writeWorkingTree = { sources: ["stdin"], sinks: ["working-tree"] } satisfies NonNullable<
  SandboxCommandMetadata["flow"]
>;
const mutateWorkingTree = {
  sources: ["working-tree"],
  sinks: ["working-tree"],
} satisfies NonNullable<SandboxCommandMetadata["flow"]>;

export const SANDBOX_COMMAND_METADATA = {
  cat: {
    command: "cat",
    description: "Print file contents from the sandboxed project filesystem or stdin.",
    flow: { sources: ["working-tree", "stdin"], sinks: ["stdout"] },
    exposure: "allow",
  },
  find: {
    command: "find",
    description: "Find paths under the sandboxed project filesystem.",
    flow: readWorkingTree,
    exposure: "allow",
  },
  grep: {
    command: "grep",
    description: "Search stdin or files in the sandboxed project filesystem with grep.",
    flow: { sources: ["working-tree", "stdin"], sinks: ["stdout"] },
    exposure: "allow",
  },
  rg: {
    command: "rg",
    description: "Search files with ripgrep in the sandboxed project filesystem.",
    flow: readWorkingTree,
    exposure: "allow",
  },
  ls: {
    command: "ls",
    description: "List files in the sandboxed project filesystem.",
    flow: readWorkingTree,
    exposure: "allow",
  },
  pwd: {
    command: "pwd",
    description: "Print the current sandbox working directory.",
    flow: { sinks: ["stdout"] },
    exposure: "allow",
  },
  echo: {
    command: "echo",
    description: "Print literal arguments to stdout without shell expansion.",
    flow: { sinks: ["stdout"] },
    exposure: "allow",
  },
  jq: {
    command: "jq",
    description: "Transform JSON from stdin or sandboxed files.",
    flow: { sources: ["stdin", "working-tree"], sinks: ["stdout"] },
    exposure: "allow",
  },
  sed: {
    command: "sed",
    description: "Transform text from stdin or sandboxed files.",
    flow: transformStdin,
    exposure: "allow",
  },
  awk: {
    command: "awk",
    description: "Process text from stdin or sandboxed files.",
    flow: transformStdin,
    exposure: "allow",
  },
  tee: {
    command: "tee",
    description: "Write stdin to files in the sandboxed project filesystem and stdout.",
    flow: writeWorkingTree,
    exposure: "requires-approval",
  },
  cp: {
    command: "cp",
    description: "Copy files within the sandboxed project filesystem.",
    flow: mutateWorkingTree,
    exposure: "requires-approval",
  },
  mv: {
    command: "mv",
    description: "Move or rename files within the sandboxed project filesystem.",
    flow: mutateWorkingTree,
    exposure: "requires-approval",
  },
  rm: {
    command: "rm",
    description: "Remove files from the sandboxed project filesystem.",
    flow: { sinks: ["working-tree"] },
    exposure: "requires-approval",
  },
  mkdir: {
    command: "mkdir",
    description: "Create directories in the sandboxed project filesystem.",
    flow: { sinks: ["working-tree"] },
    exposure: "requires-approval",
  },
  touch: {
    command: "touch",
    description: "Create files or update timestamps in the sandboxed project filesystem.",
    flow: { sinks: ["working-tree"] },
    exposure: "requires-approval",
  },
  bash: {
    command: "bash",
    description: "Run shell code through the sandbox interpreter.",
    exposure: "deny",
    notes: "Prefer TypeScript control flow and individual sh.* calls.",
  },
  sh: {
    command: "sh",
    description: "Run shell code through the sandbox interpreter.",
    exposure: "deny",
    notes: "Prefer TypeScript control flow and individual sh.* calls.",
  },
} satisfies Record<string, SandboxCommandMetadata>;

export type KnownSandboxCommand = keyof typeof SANDBOX_COMMAND_METADATA;

export function sandboxCommandMetadata(command: string): SandboxCommandMetadata {
  return (
    SANDBOX_COMMAND_METADATA[command as KnownSandboxCommand] ?? {
      command,
      description: `Sandbox command '${command}' has no reviewed metadata.`,
      exposure: "deny",
      notes: "Commands without metadata are denied by default until classified.",
    }
  );
}
