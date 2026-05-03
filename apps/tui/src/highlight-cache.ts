import type { Lang } from "./render-block.ts";

/**
 * Module-level cache of highlighted ANSI strings keyed by `${lang}::${code}`.
 *
 * Why this exists: Ink's `<Static>` renders each item exactly once and writes
 * it permanently to stdout. `HighlightedCode` highlights asynchronously (the
 * underlying `@speed-highlight/core/terminal` API is async), so without a
 * pre-warm step the Static commit happens before the highlight resolves and
 * the scrollback shows raw text forever. `LiveTurn` calls `ensureHighlighted`
 * for every highlightable string in a block before emitting it, so by the
 * time `<Static>` renders the block, `getHighlighted` returns synchronously.
 */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function key(code: string, lang: Lang): string {
  return `${lang}::${code}`;
}

export function getHighlighted(code: string, lang: Lang): string | undefined {
  return cache.get(key(code, lang));
}

export function ensureHighlighted(code: string, lang: Lang): Promise<string> {
  const k = key(code, lang);
  const cached = cache.get(k);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(k);
  if (existing) return existing;
  const p = (async () => {
    try {
      const { highlightText } = await import("@speed-highlight/core/terminal");
      const out = await highlightText(code, lang);
      cache.set(k, out);
      return out;
    } catch {
      cache.set(k, code);
      return code;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}
