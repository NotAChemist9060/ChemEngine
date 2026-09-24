/**
 * Key → action mapping for the console TUI. Kept framework-agnostic (no ink
 * import) so it is trivially unit-testable: Ink's Key is structurally a
 * superset of PressedKey.
 */
export interface PressedKey {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  meta?: boolean;
}

export type KeyAction =
  | "submit"
  | "cancel"
  | "exit"
  | "complete"
  | "history-up"
  | "history-down"
  | "scroll-up"
  | "scroll-down"
  | "clear-results"
  | "toggle-guide"
  | "backspace"
  | "delete"
  | "left"
  | "right"
  | "home"
  | "end"
  | "insert";

/**
 * SGR mouse report *tail* as delivered to useInput after Ink strips the leading
 * ESC: `[<button;col;rowM` (press/wheel) or `[<button;col;rowm` (release).
 * Dropped by the keymap so mouse bytes never insert into the input line.
 */
export const SGR_TAIL_RE = /^\[<\d+;\d+;\d+[Mm]$/;

export function keyToAction(input: string, key: PressedKey): KeyAction | null {
  if (key.return) return "submit";
  if (key.escape) return "cancel";
  if (key.tab) return "complete";
  if (key.backspace) return "backspace";
  if (key.delete) return "delete";
  if (key.upArrow) return "history-up";
  if (key.downArrow) return "history-down";
  if (key.pageUp) return "scroll-up";
  if (key.pageDown) return "scroll-down";
  if (key.home) return "home";
  if (key.end) return "end";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  // Ignore raw escape sequences (SGR mouse reports and other unknown CSI) — they
  // are not keystrokes and must never be inserted into the input line. A lone
  // ESC (length 1) still reaches the key.escape branch above.
  if (input.length > 1 && input.startsWith("\u001b")) return null;
  // Ink strips the leading ESC from unknown sequences before they reach useInput
  // (use-input.js "Strip escape prefix from broken/incomplete sequences"), so an
  // SGR mouse report arrives as its bare tail (`[<0;12;20M` / `...m`). Drop those
  // too — they must never be inserted as literal text.
  if (SGR_TAIL_RE.test(input)) return null;
  if (key.ctrl && input.toLowerCase() === "c") return "exit";
  if (key.ctrl && input.toLowerCase() === "l") return "clear-results";
  if (key.ctrl && input.toLowerCase() === "g") return "toggle-guide";
  if (input.length > 0) return "insert";
  return null;
}