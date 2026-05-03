import { useTickFlush } from "@smoovcode/ui-react";
import { Text } from "ink";
import { createElement, useState, type ReactElement } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerProps {
  color?: string;
}

/**
 * Tiny braille spinner. Re-renders every 80ms via `useTickFlush` (the only
 * sanctioned mount-time effect hook in this repo).
 */
export function Spinner({ color = "cyan" }: SpinnerProps): ReactElement {
  const [frame, setFrame] = useState(0);
  useTickFlush(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
  return createElement(Text, { color }, FRAMES[frame]);
}
