import { ansi } from "./ansi.ts";

export interface HeaderInfo {
  backend: string;
  root: string;
  model: string;
}

const LOGO = [
  ` ___ _ __ ___   ___   _____   _____ ___   __| | ___`,
  `/ __| '_ \` _ \\ / _ \\ / _ \\ \\ / / __/ _ \\ / _\` |/ _ \\`,
  `\\__ \\ | | | | | (_) | (_) \\ V / (_| (_) | (_| |  __/`,
  `|___/_| |_| |_|\\___/ \\___/ \\_/ \\___\\___/ \\__,_|\\___|`,
];

export function renderHeader(info: HeaderInfo): string[] {
  return [
    ...LOGO.map((line) => ansi.bold(line)),
    "",
    ansi.dim(`backend  ${info.backend}`),
    ansi.dim(`root     ${info.root}`),
    ansi.dim(`model    ${info.model}`),
    ansi.dim("keys     ctrl-c exit · ctrl-o expand codemode · ctrl-r expand thinking"),
  ];
}
