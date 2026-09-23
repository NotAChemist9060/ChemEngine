import { createElement, useEffect, useReducer, useRef, useState } from "react";
import { useApp, useInput } from "ink";
import { runCommand, VERSION } from "../cli/commands.ts";
import { tokenizeLine } from "../cli/repl.ts";
import { candidatesFor, lastToken } from "./completions.ts";
import { keyToAction } from "./keymap.ts";
import { filterPalette, paletteItems } from "./palette-list.ts";
import { loadConfig, loadHistory, saveHistory } from "./persist.ts";
import { initialState, reducer, type TuiConfig } from "./state.ts";
import { box, text } from "./el.ts";
import { Banner } from "./banner.ts";
import { Footer } from "./footer.ts";
import { InputBar } from "./inputbar.ts";
import { Palette } from "./palette.ts";
import { ResultPane } from "./resultpane.ts";
import { Spinner } from "./spinner.ts";

export interface AppProps {
  config?: TuiConfig;
  historySeed?: string[];
}

export function App({ config, historySeed }: AppProps) {
  const { exit } = useApp();
  const cfg = config ?? loadConfig();
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(cfg, historySeed ?? loadHistory()));
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const completionRef = useRef({ token: "", cycle: 0 });
  const exitArmed = useRef(false);

  // Persist command history whenever it changes.
  useEffect(() => {
    saveHistory(state.inputHistory);
  }, [state.inputHistory]);

  const palette = state.paletteOpen ? filterPalette(paletteItems(), state.paletteQuery) : [];
  const paletteIdx = palette.length > 0 ? state.paletteIndex % palette.length : 0;

  async function execute(line: string): Promise<void> {
    const trimmed = line.trim();
    const { command, argString } = tokenizeLine(trimmed);
    if (command === "exit" || command === "quit") {
      exit();
      return;
    }
    if (command === "clear") {
      dispatch({ type: "clear-results" });
      dispatch({ type: "clear-input" });
      setStatus(undefined);
      return;
    }
    if (command === "") {
      dispatch({ type: "clear-input" });
      return;
    }
    setRunning(true);
    setStatus(undefined);
    try {
      const output = await runCommand(command, argString);
      dispatch({ type: "submit", command: trimmed, output, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: "submit", command: trimmed, output: msg, ok: false });
    }
    setRunning(false);
  }

  useInput((input, key) => {
    const action = keyToAction(input, key);
    if (action === null) return;

    // Command palette captures keys while open.
    if (state.paletteOpen) {
      switch (action) {
        case "exit":
          exit();
          return;
        case "cancel":
          dispatch({ type: "palette-close" });
          return;
        case "submit": {
          const item = palette[state.paletteIndex % Math.max(palette.length, 1)];
          if (item) dispatch({ type: "palette-select-into-input", command: item.name });
          return;
        }
        case "history-up":
          dispatch({ type: "palette-up" });
          return;
        case "history-down":
          dispatch({ type: "palette-down" });
          return;
        case "backspace":
          dispatch({ type: "palette-backspace" });
          return;
        case "clear-results":
          dispatch({ type: "clear-results" });
          return;
        case "insert":
          dispatch({ type: "palette-insert", text: input });
          return;
        default:
          return;
      }
    }

    switch (action) {
      case "submit":
        if (state.input !== "" && !running) void execute(state.input);
        return;
      case "cancel":
        dispatch({ type: "clear-input" });
        return;
      case "exit":
        if (exitArmed.current || state.input === "") {
          exit();
          return;
        }
        exitArmed.current = true;
        setStatus("Press Ctrl+C again to exit.");
        return;
      case "complete": {
        const token = lastToken(state.input);
        const candidates = candidatesFor(state.input);
        if (candidates.length === 0) return;
        const cycle = completionRef.current.token === token ? completionRef.current.cycle + 1 : 0;
        completionRef.current = { token, cycle };
        dispatch({ type: "complete", candidates, cycle });
        return;
      }
      case "history-up":
        dispatch({ type: "history-up" });
        return;
      case "history-down":
        dispatch({ type: "history-down" });
        return;
      case "scroll-up":
        dispatch({ type: "scroll-up" });
        return;
      case "scroll-down":
        dispatch({ type: "scroll-down" });
        return;
      case "clear-results":
        dispatch({ type: "clear-results" });
        return;
      case "backspace":
        dispatch({ type: "backspace" });
        return;
      case "delete":
        dispatch({ type: "delete" });
        return;
      case "left":
        dispatch({ type: "left" });
        return;
      case "right":
        dispatch({ type: "right" });
        return;
      case "home":
        dispatch({ type: "home" });
        return;
      case "end":
        dispatch({ type: "end" });
        return;
      case "insert": {
        exitArmed.current = false;
        setStatus(undefined);
        if (input === "/" && state.input === "") dispatch({ type: "palette-toggle" });
        else dispatch({ type: "insert", text: input });
        return;
      }
      default:
        return;
    }
  });

  return box(
    { flexDirection: "column" },
    cfg.bannerOn ? createElement(Banner, { version: VERSION }) : null,
    box(
      { flexGrow: 1, flexDirection: "column" },
      createElement(ResultPane, {
        results: state.results,
        limit: cfg.resultLimit,
        scrollOffset: state.scrollOffset,
      }),
    ),
    state.paletteOpen
      ? createElement(Palette, { items: palette, index: paletteIdx, query: state.paletteQuery })
      : null,
    running ? box({ paddingX: 1 }, createElement(Spinner, { label: "computing…" })) : null,
    createElement(InputBar, { value: state.input, cursor: state.cursor }),
    status !== undefined ? box({ paddingX: 1 }, text({ color: "yellow" }, status)) : null,
    createElement(Footer, {}),
  );
}