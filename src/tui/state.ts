import { lastToken } from "./completions.ts";
import { normalizeScrollTop } from "./scroll.ts";
import { extendSelection, startSelection, type Selection } from "./select.ts";

export interface TuiConfig {
  /** How many result cards are visible (scroll beyond this) — persisted. */
  resultLimit: number;
  /** Show the banner header. */
  bannerOn: boolean;
  /** Show the right-hand guide panel when the terminal is wide enough. */
  guideOn: boolean;
}

export const DEFAULT_CONFIG: TuiConfig = { resultLimit: 8, bannerOn: true, guideOn: true };

export const HISTORY_LIMIT = 500;

export interface ResultEntry {
  id: number;
  command: string;
  output: string;
  ok: boolean;
}

export interface TuiState {
  /** Current input line. */
  input: string;
  /** Cursor position within the input line. */
  cursor: number;
  /** Commands executed this session (oldest → newest). */
  inputHistory: string[];
  /** Index into inputHistory for ↑/↓ recall; -1 = editing a fresh line. */
  historyIndex: number;
  /** Executed outputs (oldest → newest). */
  results: ResultEntry[];
  /**
   * Row offset from the top of the result stack: 0 = oldest at the top.
   * null = pinned to the newest output — the autoscroll position, restored
   * whenever a command is submitted (further results push the view to bottom).
   *
   * `max` is the marker-aware maximum from `scrollGeometry` (see scroll.ts), so
   * an offset equal to `max` is the true bottom of the stack, not the top of the
   * last card. Offsets are normalized through `clamp-scroll` whenever the
   * viewport geometry changes.
   */
  scrollTop: number | null;
  /**
   * Active drag selection over the results viewport (viewport-local), or null.
   * Cleared by typing, scrolling, submitting, clearing results, toggling the
   * guide, or opening the palette; preserved across caret moves, palette-close,
   * clear-input, and history recall.
   */
  selection: Selection | null;
  paletteOpen: boolean;
  paletteQuery: string;
  paletteIndex: number;
  nextResultId: number;
  /** Guide panel visibility (runtime toggle, seeded from config). */
  guideOn: boolean;
  config: TuiConfig;
}

export function initialState(config: TuiConfig = DEFAULT_CONFIG, seedHistory: string[] = []): TuiState {
  return {
    input: "",
    cursor: 0,
    inputHistory: seedHistory.slice(-HISTORY_LIMIT),
    historyIndex: -1,
    results: [],
    scrollTop: null,
    selection: null,
    paletteOpen: false,
    paletteQuery: "",
    paletteIndex: 0,
    nextResultId: 1,
    guideOn: config.guideOn,
    config,
  };
}

export type TuiAction =
  | { type: "insert"; text: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "history-up" }
  | { type: "history-down" }
  | { type: "submit"; command: string; output: string; ok: boolean }
  | { type: "clear-input" }
  | { type: "clear-results" }
  | { type: "scroll-up"; max: number; page: number }
  | { type: "scroll-down"; max: number; page: number }
  | { type: "wheel-up"; max: number; step: number }
  | { type: "wheel-down"; max: number; step: number }
  /** Re-normalize the offset against a new maximum (resize / re-wrap). */
  | { type: "clamp-scroll"; max: number }
  | { type: "set-cursor"; index: number }
  | { type: "select-start"; row: number; col: number }
  | { type: "select-extend"; row: number; col: number }
  | { type: "select-cancel" }
  | { type: "toggle-guide" }
  | { type: "palette-toggle" }
  | { type: "palette-close" }
  | { type: "palette-up" }
  | { type: "palette-down" }
  | { type: "palette-insert"; text: string }
  | { type: "palette-backspace" }
  | { type: "palette-select-into-input"; command: string }
  | { type: "complete"; candidates: string[]; cycle: number };

/**
 * Move the scroll offset by `delta` content rows within [0, max].
 * Reaching the bottom (== max) re-pins to autoscroll (scrollTop = null).
 */
function scrollBy(state: TuiState, delta: number, max: number): TuiState {
  const bottom = Math.max(0, max);
  const from = state.scrollTop === null ? bottom : state.scrollTop;
  const next = Math.min(Math.max(0, from + delta), bottom);
  return { ...state, scrollTop: normalizeScrollTop(next, bottom), selection: null };
}

export function reducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "insert": {
      const input = state.input.slice(0, state.cursor) + action.text + state.input.slice(state.cursor);
      return { ...state, input, cursor: state.cursor + action.text.length, selection: null };
    }
    case "backspace": {
      if (state.cursor <= 0) {
        return state.selection === null ? state : { ...state, selection: null };
      }
      const input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor);
      return { ...state, input, cursor: state.cursor - 1, selection: null };
    }
    case "delete": {
      if (state.cursor >= state.input.length) {
        return state.selection === null ? state : { ...state, selection: null };
      }
      const input = state.input.slice(0, state.cursor) + state.input.slice(state.cursor + 1);
      return { ...state, input, selection: null };
    }
    case "left":
      return state.cursor > 0 ? { ...state, cursor: state.cursor - 1 } : state;
    case "right":
      return state.cursor < state.input.length ? { ...state, cursor: state.cursor + 1 } : state;
    case "home":
      return { ...state, cursor: 0 };
    case "end":
      return { ...state, cursor: state.input.length };
    case "history-up": {
      if (state.inputHistory.length === 0) return state;
      const idx = state.historyIndex === -1 ? state.inputHistory.length - 1 : Math.max(0, state.historyIndex - 1);
      const line = state.inputHistory[idx]!;
      return { ...state, historyIndex: idx, input: line, cursor: line.length };
    }
    case "history-down": {
      if (state.historyIndex === -1) return state;
      if (state.historyIndex === state.inputHistory.length - 1) {
        return { ...state, historyIndex: -1, input: "", cursor: 0 };
      }
      const idx = state.historyIndex + 1;
      const line = state.inputHistory[idx]!;
      return { ...state, historyIndex: idx, input: line, cursor: line.length };
    }
    case "submit":
      return {
        ...state,
        inputHistory: [...state.inputHistory, action.command].slice(-HISTORY_LIMIT),
        historyIndex: -1,
        results: [
          ...state.results,
          { id: state.nextResultId, command: action.command, output: action.output, ok: action.ok },
        ],
        scrollTop: null,
        selection: null,
        nextResultId: state.nextResultId + 1,
        input: "",
        cursor: 0,
      };
    case "clear-input":
      return { ...state, input: "", cursor: 0 };
    case "clear-results":
      return { ...state, results: [], scrollTop: null, selection: null };
    case "scroll-up":
      return scrollBy(state, -Math.max(1, action.page), action.max);
    case "scroll-down":
      return scrollBy(state, +Math.max(1, action.page), action.max);
    case "wheel-up":
      return scrollBy(state, -Math.max(1, action.step), action.max);
    case "wheel-down":
      return scrollBy(state, +Math.max(1, action.step), action.max);
    case "clamp-scroll": {
      // Idempotent: return the same state when the offset is already valid so a
      // geometry change that doesn't move the view costs no extra render.
      const scrollTop = normalizeScrollTop(state.scrollTop, action.max);
      if (scrollTop === state.scrollTop && state.selection === null) return state;
      return { ...state, scrollTop, selection: null };
    }
    case "set-cursor":
      return { ...state, cursor: Math.min(Math.max(0, action.index), state.input.length) };
    case "select-start":
      return { ...state, selection: startSelection(action.row, action.col) };
    case "select-extend": {
      if (state.selection === null) return state;
      return { ...state, selection: extendSelection(state.selection, action.row, action.col) };
    }
    case "select-cancel":
      return state.selection === null ? state : { ...state, selection: null };
    case "toggle-guide":
      return { ...state, guideOn: !state.guideOn, selection: null };
    case "palette-toggle":
      return state.paletteOpen
        ? { ...state, paletteOpen: false }
        : { ...state, paletteOpen: true, paletteQuery: "", paletteIndex: 0, selection: null };
    case "palette-close":
      return { ...state, paletteOpen: false };
    case "palette-up":
      return { ...state, paletteIndex: Math.max(0, state.paletteIndex - 1) };
    case "palette-down":
      return { ...state, paletteIndex: state.paletteIndex + 1 };
    case "palette-insert":
      return { ...state, paletteQuery: state.paletteQuery + action.text };
    case "palette-backspace":
      return { ...state, paletteQuery: state.paletteQuery.slice(0, -1) };
    case "palette-select-into-input": {
      const input = `${action.command} `;
      return {
        ...state,
        paletteOpen: false,
        paletteQuery: "",
        paletteIndex: 0,
        input,
        cursor: input.length,
      };
    }
    case "complete": {
      if (action.candidates.length === 0) {
        return state.selection === null ? state : { ...state, selection: null };
      }
      const token = lastToken(state.input);
      const word = action.candidates[action.cycle % action.candidates.length]!;
      const input = state.input.slice(0, state.input.length - token.length) + word;
      return { ...state, input, cursor: input.length, selection: null };
    }
    default:
      return state;
  }
}