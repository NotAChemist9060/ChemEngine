import { COMMANDS } from "../cli/commands.ts";
import { allElements } from "../core/elements.ts";

export function commandNames(): string[] {
  return COMMANDS.map((c) => c.name);
}

/** Last whitespace-delimited token of the input line. */
export function lastToken(input: string): string {
  const m = input.match(/(\S+)$/);
  return m?.[1] ?? "";
}

/**
 * Tab-completion candidates for the current input line.
 *  - First word  → command names (prefix match on the token).
 *  - Later words → element symbols (prefix match, for formula completion).
 */
export function candidatesFor(input: string): string[] {
  const token = lastToken(input);
  const isFirstWord = input.trim() === token;
  if (isFirstWord) {
    const t = token.toLowerCase();
    if (t === "") return commandNames();
    return commandNames()
      .filter((c) => c.startsWith(t))
      .concat(commandNames().filter((c) => c.includes(t) && !c.startsWith(t)));
  }
  const t = token.toLowerCase();
  return allElements()
    .map((e) => e.symbol)
    .filter((s) => s.toLowerCase().startsWith(t))
    .slice(0, 12);
}