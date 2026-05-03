const ESC = "\u001b[";

export const ansi = {
  bold: (text: string): string => `${ESC}1m${text}${ESC}22m`,
  dim: (text: string): string => `${ESC}2m${text}${ESC}22m`,
  red: (text: string): string => `${ESC}31m${text}${ESC}39m`,
  green: (text: string): string => `${ESC}32m${text}${ESC}39m`,
  blue: (text: string): string => `${ESC}34m${text}${ESC}39m`,
  cyan: (text: string): string => `${ESC}36m${text}${ESC}39m`,
  magenta: (text: string): string => `${ESC}35m${text}${ESC}39m`,
};
