import { createElement } from "react";
import { render } from "ink";
import { App } from "./app.ts";
import { loadConfig, loadHistory } from "./persist.ts";

/**
 * Render options for the full-screen TUI. The alternate screen buffer is
 * required here: on Windows, Ink force-clears the whole terminal on every
 * "fullscreen" frame (see issue #969 workaround), which in the normal buffer
 * engages terminal scrollback (a right-hand scrollbar) and desyncs the input
 * line so typing appears dead. The alternate buffer has no scrollback and is
 * the supported surface for viewport-filling apps (vim/htop-style).
 */
export const TUI_RENDER_OPTIONS = {
  exitOnCtrlC: false,
  alternateScreen: true,
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