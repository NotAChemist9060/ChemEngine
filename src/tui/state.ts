import { lastToken } from "./completions.ts";

export interface TuiConfig {
  /** How many result cards are visible (scroll beyond this) — persisted. */
  resultLimit: number;
  /** Show the banner header. */
  bannerOn: boolean;
}

export const DEFAULT_CONFIG: TuiConfig = { resultLimit: 8, bannerOn: true };

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
  /** 0 = showing the latest results; >0 = scrolled up. */
  scrollOffset: number;
  paletteOpen: boolean;
  paletteQuery: string;
  paletteIndex: number;
  nextResultId: number;
  config: TuiConfig;
}

export function initialState(config: TuiConfig = DEFAULT_CONFIG, seedHistory: string[] = []): TuiState {
  return {
    input: "",
    cursor: 0,
    inputHistory: seedHistory.slice(-HISTORY_LIMIT),
    historyIndex: -1,
    results: [],
    scrollOffset: 0,
    paletteOpen: false,
    paletteQuery: "",
    paletteIndex: 0,
    nextResultId: 1,
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
  | { type: "scroll-up" }
  | { type: "scroll-down" }
  | { type: "palette-toggle" }
  | { type: "palette-close" }
  | { type: "palette-up" }
  | { type: "palette-down" }
  | { type: "palette-insert"; text: string }
  | { type: "palette-backspace" }
  | { type: "palette-select-into-input"; command: string }
  | { type: "complete"; candidates: string[]; cycle: number };

export function reducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "insert": {
      const input = state.input.slice(0, state.cursor) + action.text + state.input.slice(state.cursor);
      return { ...state, input, cursor: state.cursor + action.text.length };
    }
    case "backspace": {
      if (state.cursor <= 0) return state;
      const input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor);
      return { ...state, input, cursor: state.cursor - 1 };
    }
    case "delete": {
      if (state.cursor >= state.input.length) return state;
      const input = state.input.slice(0, state.cursor) + state.input.slice(state.cursor + 1);
      return { ...state, input };
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
        scrollOffset: 0,
        nextResultId: state.nextResultId + 1,
        input: "",
        cursor: 0,
      };
    case "clear-input":
      return { ...state, input: "", cursor: 0 };
    case "clear-results":
      return { ...state, results: [], scrollOffset: 0 };
    case "scroll-up": {
      const maxOffset = Math.max(0, state.results.length - state.config.resultLimit);
      return state.scrollOffset < maxOffset ? { ...state, scrollOffset: state.scrollOffset + 1 } : state;
    }
    case "scroll-down":
      return state.scrollOffset > 0 ? { ...state, scrollOffset: state.scrollOffset - 1 } : state;
    case "palette-toggle":
      return state.paletteOpen
        ? { ...state, paletteOpen: false }
        : { ...state, paletteOpen: true, paletteQuery: "", paletteIndex: 0 };
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
      if (action.candidates.length === 0) return state;
      const token = lastToken(state.input);
      const word = action.candidates[action.cycle % action.candidates.length]!;
      const input = state.input.slice(0, state.input.length - token.length) + word;
      return { ...state, input, cursor: input.length };
    }
    default:
      return state;
  }
}