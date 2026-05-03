import { Text } from "ink";
import { createElement, useRef, useState, type ReactElement } from "react";
import { ensureHighlighted, getHighlighted } from "./highlight-cache.ts";

/**
 * Languages we support today via @speed-highlight/core. Adding a new one is
 * just a matter of confirming the loader exists in
 * `node_modules/@speed-highlight/core/dist/languages/`.
 */
export type Lang = "ts" | "js" | "json" | "md" | "go";

interface HighlightedCodeProps {
  code: string;
  lang: Lang;
}

/**
 * Renders syntax-highlighted code. The highlighter is async, so we read from a
 * shared cache synchronously: a hit renders the ANSI version on the very first
 * frame (which is what `<Static>` requires — it commits items once). On a miss
 * we render raw text, kick off the async fill, and `setRendered` swaps in the
 * highlighted version when it arrives. The setState path only matters in live
 * regions where re-renders are honored; `<Static>` items rely on the cache
 * being pre-warmed by `LiveTurn` before the block is emitted.
 */
export function HighlightedCode({ code, lang }: HighlightedCodeProps): ReactElement {
  const cached = getHighlighted(code, lang);
  const [rendered, setRendered] = useState(cached ?? code);
  const lastInputRef = useRef<{ code: string; lang: Lang } | null>(null);

  if (
    lastInputRef.current === null ||
    lastInputRef.current.code !== code ||
    lastInputRef.current.lang !== lang
  ) {
    lastInputRef.current = { code, lang };
    const cachedNow = getHighlighted(code, lang);
    if (cachedNow !== undefined) {
      if (rendered !== cachedNow) setRendered(cachedNow);
    } else {
      if (rendered !== code) setRendered(code);
      void ensureHighlighted(code, lang).then((out) => {
        if (
          lastInputRef.current &&
          lastInputRef.current.code === code &&
          lastInputRef.current.lang === lang
        ) {
          setRendered(out);
        }
      });
    }
  }

  return createElement(Text, null, rendered);
}
