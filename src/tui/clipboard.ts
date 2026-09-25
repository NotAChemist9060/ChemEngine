import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultDataDir } from "./persist.ts";

/**
 * Clipboard support for the TUI.
 *
 * Primary path is OSC 52 (`ESC ] 52 ; c ; <base64> BEL`), which real terminals
 * (and terminal multiplexers such as tmux/screen, when enabled) translate into
 * a system-clipboard write. When stdout is not a TTY (piped runs, some SSH
 * setups), the selection is written to `~/.chemengine/last-selection.txt` so it
 * is still recoverable.
 */

/** The characters that may legally appear in an OSC 52 payload (may be empty). */
export const OSC52_BASE64_RE = /^[A-Za-z0-9+/=]*$/;

/** Encode `text` as an OSC 52 clipboard sequence (UTF-8 bytes, base64). */
export function encodeOsc52(text: string): string {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  return `\x1b]52;c;${b64}\x07`;
}

/** Minimal stdout surface — injectable so tests don't need a real WriteStream. */
export interface ClipboardStdout {
  readonly isTTY: boolean;
  write(chunk: string): unknown;
}

/** Injectable filesystem for the non-TTY fallback. */
export interface ClipboardDeps {
  writeFileSync?: (path: string, data: string) => void;
  mkdirSync?: (path: string, opts: { recursive: true }) => void;
  /** Directory for the fallback file (defaults to `~/.chemengine`). */
  dir?: string;
}

export type ClipboardResult = "osc52" | "file" | "none";

/**
 * Copy `text` to the clipboard.
 *
 * - TTY stdout → OSC 52 escape sequence, returns `"osc52"`.
 * - non-TTY stdout with non-empty text → `~/.chemengine/last-selection.txt`,
 *   returns `"file"` (dir created on demand).
 * - non-TTY stdout with empty text → no-op, returns `"none"`.
 */
export function writeClipboard(
  text: string,
  stdout: ClipboardStdout,
  deps: ClipboardDeps = {},
): ClipboardResult {
  if (stdout.isTTY) {
    stdout.write(encodeOsc52(text));
    return "osc52";
  }
  if (text.length === 0) return "none";
  const write = deps.writeFileSync ?? writeFileSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;
  const dir = deps.dir ?? defaultDataDir();
  mkdir(dir, { recursive: true });
  write(join(dir, "last-selection.txt"), text);
  return "file";
}