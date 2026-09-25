import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultDataDir } from "./persist.ts";

/**
 * Clipboard support for the TUI.
 *
 * On Windows, a hidden `clip.exe` process is the primary path. TTY-capable
 * terminals retain OSC 52 as a fallback. When stdout is not a TTY (piped runs,
 * some SSH setups), the selection is written to `~/.chemengine/last-selection.txt`
 * so it is still recoverable.
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

/** Minimal child-process surface needed to feed and await `clip.exe`. */
export interface ClipboardProcess {
  readonly stdin: { end(data: string): unknown } | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

/** Injectable process runner so native success/failure is deterministic in tests. */
export type ClipboardProcessRunner = (
  command: string,
  args: readonly string[],
  options: { windowsHide: boolean; stdio: ["pipe", "ignore", "ignore"] },
) => ClipboardProcess;

/** Injectable platform/filesystem dependencies for clipboard fallbacks. */
export interface ClipboardDeps {
  platform?: NodeJS.Platform;
  runProcess?: ClipboardProcessRunner;
  writeFileSync?: (path: string, data: string) => void;
  mkdirSync?: (path: string, opts: { recursive: true }) => void;
  /** Directory for the fallback file (defaults to `~/.chemengine`). */
  dir?: string;
}

export type ClipboardResult = "native" | "osc52" | "file" | "none";

const defaultProcessRunner: ClipboardProcessRunner = (command, args, options) =>
  spawn(command, args, options);

/**
 * Feed `text` to hidden `clip.exe` and resolve only after the process finishes.
 * A clean exit is the only result treated as native success; spawn/error and
 * nonzero exits all resolve false so the caller can continue the fallback chain.
 */
function runNativeWindowsClipboard(text: string, runProcess: ClipboardProcessRunner): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ClipboardProcess;
    try {
      child = runProcess("clip.exe", [], {
        windowsHide: true,
        stdio: ["pipe", "ignore", "ignore"],
      });
    } catch {
      resolve(false);
      return;
    }

    if (child.stdin === null) {
      resolve(false);
      return;
    }

    let settled = false;
    const settle = (success: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(success);
    };

    child.once("error", () => settle(false));
    child.once("close", (code) => settle(code === 0));
    try {
      child.stdin.end(text);
    } catch {
      settle(false);
    }
  });
}

function writeSelectionFile(text: string, deps: ClipboardDeps): boolean {
  try {
    const write = deps.writeFileSync ?? writeFileSync;
    const mkdir = deps.mkdirSync ?? mkdirSync;
    const dir = deps.dir ?? defaultDataDir();
    mkdir(dir, { recursive: true });
    write(join(dir, "last-selection.txt"), text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `text` through the first method that actually succeeds.
 *
 * - Empty text → no-op, returns `"none"`.
 * - Windows native `clip.exe` success → returns `"native"`.
 * - TTY stdout after native failure (or on other platforms) → OSC 52, returns
 *   `"osc52"`.
 * - Non-TTY stdout (or an OSC write failure) → `last-selection.txt`, returns
 *   `"file"`.
 * - If every applicable fallback fails, returns `"none"`.
 */
export async function writeClipboard(
  text: string,
  stdout: ClipboardStdout,
  deps: ClipboardDeps = {},
): Promise<ClipboardResult> {
  if (text.length === 0) return "none";

  if ((deps.platform ?? process.platform) === "win32") {
    const native = await runNativeWindowsClipboard(text, deps.runProcess ?? defaultProcessRunner);
    if (native) return "native";
  }

  if (stdout.isTTY) {
    try {
      stdout.write(encodeOsc52(text));
      return "osc52";
    } catch {
      // Continue to the recoverable file fallback.
    }
  }

  return writeSelectionFile(text, deps) ? "file" : "none";
}
