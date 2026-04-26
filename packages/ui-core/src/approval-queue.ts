/**
 * FIFO state machine bridging the agent (which awaits boolean approvals) and a
 * UI (which observes the head of the queue and resolves it). The agent calls
 * `enqueue(req)` and awaits the returned promise. The UI subscribes for
 * change notifications, reads the head via `peek()`, and calls `resolve(b)`
 * when the user makes a decision.
 */
export class ApprovalQueue<T> {
  private readonly entries: Array<{ req: T; resolve: (approved: boolean) => void }> = [];
  private readonly listeners = new Set<() => void>();

  enqueue(req: T): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.entries.push({ req, resolve });
      this.notify();
    });
  }

  peek(): T | null {
    return this.entries[0]?.req ?? null;
  }

  resolve(approved: boolean): void {
    const entry = this.entries.shift();
    if (!entry) throw new Error("ApprovalQueue: resolve() called with no pending request");
    entry.resolve(approved);
    this.notify();
  }

  size(): number {
    return this.entries.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
