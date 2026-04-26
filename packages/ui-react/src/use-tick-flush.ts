import { useRef } from "react";
import { useMountEffect } from "./use-mount-effect.ts";

/**
 * Periodically invokes `callback` every `ms` while the component is mounted.
 * The latest `callback` is always used; the timer is set up once on mount and
 * torn down on unmount.
 */
export function useTickFlush(callback: () => void, ms: number): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useMountEffect(() => {
    const handle = setInterval(() => cbRef.current(), ms);
    return () => clearInterval(handle);
  });
}
