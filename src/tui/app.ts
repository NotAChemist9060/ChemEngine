import { createElement, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useApp, useInput, useWindowSize } from "ink";
import { runCommand, VERSION } from "../cli/commands.ts";
import { tokenizeLine } from "../cli/repl.ts";
import { allElements } from "../core/elements.ts";
import { candidatesFor, commandNames, lastToken } from "./completions.ts";
import { keyToAction } from "./keymap.ts";
import { layout, viewHeight, BANNER_ROWS, FOOTER_ROWS, INFO_ROWS, INPUT_ROWS } from "./layout.ts";
import { guideSections, Guide } from "./guide.ts";
import { filterPalette, paletteItems } from "./palette-list.ts";
import { loadConfig, loadHistory, saveConfig, saveHistory } from "./persist.ts";
import { initialState, reducer, type TuiConfig } from "./state.ts";
import { pageStep, resultHeights, scrollMax, WHEEL_STEP } from "./scroll.ts";
import { box, text } from "./el.ts";
import type { MouseIntent } from "./mouse.ts";
import { MouseBridge } from "./mousebridge.ts";
import { Banner, EngineInfo } from "./banner.ts";
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
  const { rows, columns } = useWindowSize();
  const cfg = config ?? loadConfig();
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(cfg, historySeed ?? loadHistory()));
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const completionRef = useRef({ token: "", cycle: 0 });
  const exitArmed = useRef(false);

  // One row under the terminal so Ink's incremental diff renderer is used (a
  // fullscreen frame would make Ink force-clear the whole terminal every render
  // on Windows — the visible blink while typing).
  const viewRows = viewHeight(rows);
  const lay = layout(viewRows, columns, state.guideOn);

  // Persist command history and the guide preference when they change.
  useEffect(() => {
    saveHistory(state.inputHistory);
  }, [state.inputHistory]);
  useEffect(() => {
    saveConfig({ resultLimit: cfg.resultLimit, bannerOn: cfg.bannerOn, guideOn: state.guideOn });
  }, [state.guideOn, cfg.bannerOn, cfg.resultLimit]);

  const palette = state.paletteOpen ? filterPalette(paletteItems(), state.paletteQuery) : [];
  const paletteIdx = palette.length > 0 ? state.paletteIndex % palette.length : 0;
  const sections = guideSections({
    version: VERSION,
    commands: commandNames(),
    elementCount: allElements().length,
  });

  // Exact card width for height/scroll math: full width minus the guide panel
  // and the result pane's 1-col padding on each side — the same width the
  // cards are rendered with, so wrap counts match Ink exactly.
  const cardWidth = Math.max(1, columns - (lay.showGuide ? lay.guideWidth : 0) - 2);
  // Scroll extent of the current result stack, recomputed every render.
  const scrollMaxRows = scrollMax(resultHeights(state.results, cardWidth), lay.viewportRows);

  // Mouse intents need the freshest scroll max without re-registering the
  // stdin listener; the bridge reads through a ref updated each render.
  const maxRef = useRef(scrollMaxRows);
  maxRef.current = scrollMaxRows;
  const onMouseIntent = useCallback((intent: MouseIntent) => {
    if (intent.kind === "scroll") {
      const max = maxRef.current;
      if (intent.dir === 1) dispatch({ type: "wheel-up", max, step: WHEEL_STEP });
      else dispatch({ type: "wheel-down", max, step: WHEEL_STEP });
    } else {
      dispatch({ type: "set-cursor", index: intent.index });
    }
  }, []);

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
      case "toggle-guide":
        dispatch({ type: "toggle-guide" });
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
        dispatch({ type: "scroll-up", max: scrollMaxRows, page: pageStep(lay.viewportRows) });
        return;
      case "scroll-down":
        dispatch({ type: "scroll-down", max: scrollMaxRows, page: pageStep(lay.viewportRows) });
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

  // Fixed full-screen layout: all chrome is pinned with exact heights and
  // flexShrink 0 so tall result stacks (or window resizes) can never squeeze
  // the input line away. The middle region owns all scrolling and clips.
  return box(
    { flexDirection: "column", height: viewRows },
    createElement(MouseBridge, {
      ctx: { active: !state.paletteOpen, inputRow: lay.inputRow, inputLength: state.input.length },
      onIntent: onMouseIntent,
    }),
    lay.showBanner
      ? box({ height: BANNER_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(Banner, { version: VERSION }))
      : null,
    lay.showInfo
      ? box({ height: INFO_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(EngineInfo, { elementCount: allElements().length }))
      : null,
    lay.viewportRows > 0
      ? box(
          { height: lay.viewportRows, flexShrink: 0, flexDirection: "column", overflowY: "hidden" },
          box(
            { flexDirection: "row", flexGrow: 1 },
            box(
              { flexGrow: 1, flexDirection: "column", overflowY: "hidden" },
              createElement(ResultPane, {
                results: state.results,
                scrollTop: state.scrollTop,
                viewportRows: lay.viewportRows,
                width: cardWidth,
              }),
            ),
            lay.showGuide ? createElement(Guide, { sections, width: lay.guideWidth }) : null,
          ),
          state.paletteOpen ? createElement(Palette, { items: palette, index: paletteIdx, query: state.paletteQuery }) : null,
          running ? box({ paddingX: 1 }, createElement(Spinner, { label: "computing…" })) : null,
          status !== undefined ? box({ paddingX: 1 }, text({ color: "yellow" }, status)) : null,
        )
      : null,
    box({ height: INPUT_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(InputBar, { value: state.input, cursor: state.cursor })),
    lay.showInfo
      ? box({ height: FOOTER_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(Footer, {}))
      : null,
  );
}