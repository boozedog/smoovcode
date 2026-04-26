import type { ApprovalQueue } from "@smoovcode/ui-core";
import { useCallback, useState } from "react";
import { useMountEffect } from "./use-mount-effect.ts";

export interface UseApprovalQueueResult<T> {
  pending: T | null;
  resolve: (approved: boolean) => void;
}

/**
 * React binding for `ApprovalQueue`. Subscribes to the queue on mount and
 * re-renders whenever the head changes. The returned `resolve` is a stable
 * reference that resolves the head when called.
 */
export function useApprovalQueue<T>(queue: ApprovalQueue<T>): UseApprovalQueueResult<T> {
  const [pending, setPending] = useState<T | null>(() => queue.peek());

  useMountEffect(() => {
    const sync = () => setPending(queue.peek());
    const unsubscribe = queue.subscribe(sync);
    sync();
    return unsubscribe;
  });

  const resolve = useCallback(
    (approved: boolean) => {
      queue.resolve(approved);
    },
    [queue],
  );

  return { pending, resolve };
}
