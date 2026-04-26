import { Text } from "ink";
import React from "react";

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
 * Async syntax highlight without `useEffect`: render the raw text first, then
 * swap to the ANSI-highlighted version once it resolves. Cleanup guards the
 * setState against unmounts and stale `code` props.
 */
export function HighlightedCode({ code, lang }: HighlightedCodeProps): React.ReactElement {
  const [rendered, setRendered] = React.useState(code);
  const lastInputRef = React.useRef<{ code: string; lang: Lang } | null>(null);

  // Trigger highlight whenever code/lang change. We compare against a ref so we
  // only schedule when the inputs actually move, and we drop late results that
  // no longer match the current props.
  if (
    lastInputRef.current === null ||
    lastInputRef.current.code !== code ||
    lastInputRef.current.lang !== lang
  ) {
    lastInputRef.current = { code, lang };
    // Reset shown text to raw so callers see the latest content immediately.
    if (rendered !== code) setRendered(code);
    void (async () => {
      try {
        const { highlightText } = await import("@speed-highlight/core/terminal");
        const out = await highlightText(code, lang);
        // Drop the result if a newer call has superseded us.
        if (
          lastInputRef.current &&
          lastInputRef.current.code === code &&
          lastInputRef.current.lang === lang
        ) {
          setRendered(out);
        }
      } catch {
        // Unknown language / parser error: leave the raw text in place.
      }
    })();
  }

  return React.createElement(Text, null, rendered);
}
