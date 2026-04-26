import type { ConversationEvent } from "./reduce-conversation.ts";

/**
 * Async iterator transformer that coalesces consecutive `text` / `reasoning`
 * delta events of the same type into single events, flushing whenever:
 *   - a different event type arrives (incl. switching text↔reasoning),
 *   - more than `tickMs` has elapsed since the buffer's first delta,
 *   - or the upstream stream ends.
 *
 * Anti-flashing primitive: downstream renderers see fewer, larger updates
 * instead of one render per token.
 */
export async function* coalesceTextDeltas(
  stream: AsyncIterable<ConversationEvent>,
  tickMs: number,
): AsyncGenerator<ConversationEvent> {
  let pending: { type: "text" | "reasoning"; delta: string } | null = null;
  let pendingSince = 0;

  for await (const ev of stream) {
    if (ev.type === "text" || ev.type === "reasoning") {
      const now = Date.now();
      const expired = pending !== null && now - pendingSince >= tickMs;
      if (pending && pending.type === ev.type && !expired) {
        pending.delta += ev.delta;
      } else {
        if (pending) yield { type: pending.type, delta: pending.delta };
        pending = { type: ev.type, delta: ev.delta };
        pendingSince = now;
      }
    } else {
      if (pending) {
        yield { type: pending.type, delta: pending.delta };
        pending = null;
      }
      yield ev;
    }
  }

  if (pending) yield { type: pending.type, delta: pending.delta };
}
