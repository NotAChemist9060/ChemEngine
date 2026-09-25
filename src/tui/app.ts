import { createElement, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useApp, useInput, useStdout, useWindowSize } from "ink";
import { runCommand, VERSION } from "../cli/commands.ts";
import { tokenizeLine } from "../cli/repl.ts";
import { allElements } from "../core/elements.ts";
import { candidatesFor, commandNames, lastToken } from "./completions.ts";
import { keyToAction } from "./keymap.ts";
import { layout, viewHeight, BANNER_ROWS, FOOTER_ROWS, INFO_ROWS, INPUT_ROWS, RESULT_LEFT } from "./layout.ts";
import { guideSections, Guide } from "./guide.ts";
import { filterPalette, paletteItems } from "./palette-list.ts";
import { loadConfig, loadHistory, saveConfig, saveHistory } from "./persist.ts";
import { initialState, reducer, type TuiConfig } from "./state.ts";
import { buildScreenLines, pageStep, resultHeights, scrollMax, WHEEL_STEP } from "./scroll.ts";
import { box, text } from "./el.ts";
import type { MouseIntent } from "./mouse.ts";
import { MouseBridge } from "./mousebridge.ts";
import { Banner, EngineInfo } from "./banner.ts";
import { Footer } from "./footer.ts";
import { InputBar } from "./inputbar.ts";
import { Palette } from "./palette.ts";
import { ResultPane } from "./resultpane.ts";
import { Spinner } from "./spinner.ts";
import { extendSelection, extractSelectionText, hasArea, startSelection, type Selection } from "./select.ts";
import {
  writeClipboard,
  type ClipboardResult,
  type ClipboardStdout,
} from "./clipboard.ts";

export type ClipboardWriter = (
  text: string,
  stdout: ClipboardStdout,
) => Promise<ClipboardResult>;

/** Human-readable toast for a clipboard method confirmed by the writer. */
export function clipboardStatus(method: Exclude<ClipboardResult, "none">, length: number): string {
  switch (method) {
    case "native":
      return `copied ${length} chars → native clipboard`;
    case "osc52":
      return `copied ${length} chars → terminal clipboard`;
    case "file":
      return `copied ${length} chars → last-selection.txt`;
  }
}

export interface AppProps {
  config?: TuiConfig;
  historySeed?: string[];
  /**
   * Test seam: receives a sink that feeds raw SGR bytes into the mouse parser
   * (headless drag testing — see MouseBridge's `emitToParser`).
   */
  testEmitMouse?: (emit: (seq: string) => void) => void;
  /** Injectable clipboard implementation for deterministic app-level tests. */
  clipboardWriter?: ClipboardWriter;
}

export function App({ config, historySeed, testEmitMouse, clipboardWriter }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
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

  // Mouse intents run in a stable callback (useCallback([])), so any state,
  // geometry or stream they need must be read through refs refreshed here.
  const selRef = useRef<Selection | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const geomRef = useRef(lay);
  geomRef.current = lay;
  const stdoutRef = useRef(stdout);
  stdoutRef.current = stdout;
  const clipboardRef = useRef<ClipboardWriter>(clipboardWriter ?? writeClipboard);
  clipboardRef.current = clipboardWriter ?? writeClipboard;

  // Persist command history and the guide preference when they change.
  useEffect(() => {
    saveHistory(state.inputHistory);
  }, [state.inputHistory]);
  useEffect(() => {
    saveConfig({ resultLimit: cfg.resultLimit, bannerOn: cfg.bannerOn, guideOn: state.guideOn });
  }, [state.guideOn, cfg.bannerOn, cfg.resultLimit]);

  // A window resize invalidates in-flight drag coordinates — drop any selection.
  useEffect(() => {
    dispatch({ type: "select-cancel" });
  }, [rows, columns, dispatch]);

  const palette = state.paletteOpen ? filterPalette(paletteItems(), state.paletteQuery) : [];
  const paletteIdx = palette.length > 0 ? state.paletteIndex % palette.length : 0;
  const sections = guideSections({
    version: VERSION,
    commands: commandNames(),
    elementCount: allElements().length,
  });

  // Scroll extent of the current result stack, recomputed every render.
  const scrollMaxRows = scrollMax(resultHeights(state.results, lay.resultWidth), lay.viewportRows);

  // A resize can change the content width and therefore the wrapped card
  // heights. Normalize the stored offset whenever that extent changes; the
  // reducer keeps valid offsets, clamps stale ones, and re-pins the bottom.
  useEffect(() => {
    dispatch({ type: "clamp-scroll", max: scrollMaxRows });
  }, [scrollMaxRows, dispatch]);

  // Mouse intents need the freshest scroll max without re-registering the
  // stdin listener; the bridge reads through a ref updated each render.
  const maxRef = useRef(scrollMaxRows);
  maxRef.current = scrollMaxRows;
  const onMouseIntent = useCallback((intent: MouseIntent) => {
    switch (intent.kind) {
      case "scroll": {
        const max = maxRef.current;
        if (intent.dir === 1) dispatch({ type: "wheel-up", max, step: WHEEL_STEP });
        else dispatch({ type: "wheel-down", max, step: WHEEL_STEP });
        return;
      }
      case "set-cursor":
        dispatch({ type: "set-cursor", index: intent.index });
        return;
      case "select-start":
        dispatch({ type: "select-start", row: intent.row, col: intent.col });
        // Reducer dispatches are synchronous but renders are not, so a release
        // arriving in the same stdin chunk as the last motion would read a stale
        // box from a ref that only updates on render. Mirror the box here
        // synchronously so finish always copies exactly what was dragged.
        selRef.current = startSelection(intent.row, intent.col);
        return;
      case "select-extend":
        dispatch({ type: "select-extend", row: intent.row, col: intent.col });
        if (selRef.current) selRef.current = extendSelection(selRef.current, intent.row, intent.col);
        return;
      case "select-finish": {
        const sel = selRef.current;
        selRef.current = null; // one copy per drag — a stray release can't re-fire
        if (sel === null || !hasArea(sel)) {
          dispatch({ type: "select-cancel" });
          return;
        }
        const g = geomRef.current;
        const snap = stateRef.current;
        const copied = extractSelectionText(
          buildScreenLines(snap.results, snap.scrollTop, g.viewportRows, g.resultWidth),
          sel,
        );
        dispatch({ type: "select-cancel" }); // highlight clears with the release
        void (async () => {
          let method: ClipboardResult;
          try {
            method = await clipboardRef.current(copied, stdoutRef.current);
          } catch {
            return;
          }
          if (method === "none") return;
          setStatus(clipboardStatus(method, copied.length));
        })();
        return;
      }
      default:
        return;
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
        // Esc order: command palette → active selection → input line.
        if (state.paletteOpen) {
          dispatch({ type: "palette-close" });
          return;
        }
        if (state.selection !== null) {
          dispatch({ type: "select-cancel" });
          return;
        }
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
      ctx: {
        active: !state.paletteOpen,
        inputRow: lay.inputRow,
        inputLength: state.input.length,
        viewportTop: lay.viewportTop,
        viewportRows: lay.viewportRows,
        resultLeft: RESULT_LEFT,
        resultWidth: lay.resultWidth,
        selectionActive: state.selection !== null,
      },
      onIntent: onMouseIntent,
      ...(testEmitMouse !== undefined ? { emitToParser: testEmitMouse } : {}),
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
                width: lay.resultWidth,
                selection: state.selection,
              }),
            ),
            lay.showGuide ? createElement(Guide, { sections, width: lay.guideWidth }) : null,
          ),
          state.paletteOpen ? createElement(Palette, { items: palette, index: paletteIdx, query: state.paletteQuery }) : null,
          running ? box({ paddingX: 1 }, createElement(Spinner, { label: "computing…" })) : null,
          // Overlay, not a layout row: a status line must not reflow the results
          // region (that would repaint the whole pane and break incremental
          // rendering — the toast pins to the viewport's bottom row instead).
          status !== undefined
            ? box({ position: "absolute", bottom: 0, paddingX: 1 }, text({ color: "yellow" }, status))
            : null,
        )
      : null,
    box({ height: INPUT_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(InputBar, { value: state.input, cursor: state.cursor })),
    lay.showInfo
      ? box({ height: FOOTER_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(Footer, {}))
      : null,
  );
}