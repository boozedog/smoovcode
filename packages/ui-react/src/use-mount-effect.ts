import { useEffect } from "react";

/**
 * The only file in the repo allowed to name `useEffect`. All other code must
 * use this hook for one-time external sync (subscriptions, DOM integration,
 * third-party widget lifecycles). Cleanup is supported — return a function
 * from the callback.
 */
export function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line no-restricted-syntax
  useEffect(effect, []);
}
