import { createElement } from "react";
import { render } from "ink";
import { App } from "./app.ts";
import { loadConfig, loadHistory } from "./persist.ts";

/**
 * Render options for the full-screen TUI. Two layers keep the frame steady
 * while typing (no lower-half blink on Windows):
 *
 * 1. `alternateScreen` — the alternate buffer has no scrollback and is the
 *    supported surface for viewport-filling apps (vim/htop-style), so the
 *    win32 fullscreen path can't engage terminal scrollback.
 * 2. `incrementalRendering` — WITHOUT it Ink uses its standard renderer, which
 *    erases and rewrites the ENTIRE frame on every keystroke (log-update.js
 *    `createStandard`); measured 3.7 KB/frame with the guide open vs 1.6 KB
 *    without — the visible full-frame blink. With incremental rendering
 *    (log-update.js `createIncremental`) only changed lines are written: the
 *    input row alone (~105 B/keystroke, no full-line erases). Ink defaults this
 *    to false (render.js), so it must be explicit here.
 * 3. The frame is sized one row under the terminal (VIEW_PAD in layout.ts) so
 *    Ink never classifies it as fullscreen — otherwise the win32 path
 *    force-clears the whole terminal on every render (ink.js shouldClear
 *    workaround for #969).
 */
export const TUI_RENDER_OPTIONS = {
  exitOnCtrlC: false,
  alternateScreen: true,
  incrementalRendering: true,
} as const;

/**
 * Launch the full-screen console TUI. Only ever called when stdin and stdout
 * are attached to a terminal (see src/cli/index.ts); otherwise the plain REPL
 * or one-shot mode is used.
 */
export function startTui(): void {
  const config = loadConfig();
  const historySeed = loadHistory();
  render(createElement(App, { config, historySeed }), TUI_RENDER_OPTIONS);
}