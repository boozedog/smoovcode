import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Walk up from `start` to find the nearest ancestor that looks like a project
 * root (contains `.smoov/` or `.git/`). Used as the OverlayFs root so the
 * sandbox covers the whole repo rather than just the caller's cwd. Falls back
 * to `start` if no marker is found.
 */
export function findProjectRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, ".smoov")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
