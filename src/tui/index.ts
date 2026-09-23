import { createElement } from "react";
import { render } from "ink";
import { App } from "./app.ts";
import { loadConfig, loadHistory } from "./persist.ts";

/**
 * Launch the full-screen console TUI. Only ever called when stdin and stdout
 * are attached to a terminal (see src/cli/index.ts); otherwise the plain REPL
 * or one-shot mode is used.
 */
export function startTui(): void {
  const config = loadConfig();
  const historySeed = loadHistory();
  render(createElement(App, { config, historySeed }), { exitOnCtrlC: false });
}