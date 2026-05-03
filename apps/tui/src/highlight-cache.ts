import type { Lang } from "./render-block.ts";

/**
 * Module-level cache of highlighted ANSI strings keyed by `${lang}::${code}`.
 *
 * Why this exists: the terminal renderer is synchronous, while the underlying
 * `@speed-highlight/core/terminal` API is async. Finalized blocks pre-warm the
 * cache before entering scrollback, so `renderBlock` can synchronously return
 * highlighted ANSI strings via `getHighlighted` without bringing React back.
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
