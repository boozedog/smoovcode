export function isGhosttyTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERM_PROGRAM?.toLowerCase() === "ghostty";
}

export function enableMouseTrackingSequence(env: NodeJS.ProcessEnv = process.env): string {
  // Ghostty's native drag-to-select takes precedence over TUI mouse affordances.
  // Any mouse reporting mode causes drags to be delivered to the app instead of
  // starting a normal terminal text selection.
  if (isGhosttyTerminal(env)) return "";
  return "\u001B[?1000h\u001B[?1002h\u001B[?1006h";
}

export function disableMouseTrackingSequence(env: NodeJS.ProcessEnv = process.env): string {
  if (isGhosttyTerminal(env)) return "";
  return "\u001B[?1000l\u001B[?1002l\u001B[?1006l";
}
