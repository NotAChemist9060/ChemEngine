/**
 * SGR (1006) mouse support for the TUI.
 *
 * The terminal is put into mouse-reporting mode with `?1000h` (press/release
 * and wheel events), `?1002h` (drag/motion reporting — needed so a left-drag
 * over the results area produces a stream of motion reports) and `?1006h`
 * (SGR coordinates). Events arrive on stdin as `ESC [ < button ; col ; row
 * (M | m)` — press, wheel and motion end in `M`, release in `m`. Since
 * sequences can be split across stdin chunks, `createMouseParser()` buffers
 * partial sequences until they complete.
 *
 * Ink's own input parser emits an unknown CSI sequence whole (input-parser.js
 * keeps buffering until the final byte), so the keymap can ignore mouse reports
 * by prefix (`isMouseSequence`) and they never leak into the input line.
 */

/** Enable press/release + wheel + drag motion reporting with SGR coordinates. */
export const ENABLE_MOUSE = "\u001b[?1006h\u001b[?1000h\u001b[?1002h";

/** Disable mouse reporting. */
export const DISABLE_MOUSE = "\u001b[?1006l\u001b[?1000l\u001b[?1002l";

export interface SgrMouseEvent {
  kind: "press" | "release" | "wheel" | "motion";
  /** Raw SGR button code (0 left, 1 middle, 2 right, 64 wheel-up, 65 wheel-down). */
  button: number;
  /** 1-based terminal column. */
  col: number;
  /** 1-based terminal row. */
  row: number;
  /** +1 = toward older results, -1 = toward newer — wheel events only. */
  wheelDir?: 1 | -1;
  /** Low 5 bits of a motion button code (0 = left drag) — motion events only. */
  heldButton?: number;
}

/** True when a keyboard input string is an SGR mouse report (safe to ignore). */
export function isMouseSequence(input: string): boolean {
  return input.startsWith("\u001b[<");
}

const SGR_RE = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/;

/** Parse one complete SGR sequence string; returns null for non-mouse input. */
export function parseSgr(seq: string): SgrMouseEvent | null {
  const m = SGR_RE.exec(seq);
  if (!m) return null;
  const button = Number.parseInt(m[1]!, 10);
  const col = Number.parseInt(m[2]!, 10);
  const row = Number.parseInt(m[3]!, 10);
  const final = m[4];
  if (button >= 64 && button <= 67 && final === "M") {
    return { kind: "wheel", button, col, row, wheelDir: button === 64 ? 1 : -1 };
  }
  // Motion reports set bit 5 (0x20) and keep the held button in the low 5 bits.
  // Wheel codes (64+) can't collide — their bit 5 is clear — so wheel handling
  // above is untouched by this branch. A drag-release like `<32;…m` ends in `m`
  // and therefore stays a `release`, not a `motion`.
  if (final === "M" && (button & 0x20) !== 0) {
    return { kind: "motion", button, col, row, heldButton: button & 0x1f };
  }
  return { kind: final === "M" ? "press" : "release", button, col, row };
}

export interface MouseParser {
  /** Feed a stdin chunk; returns any completed mouse events. */
  push(chunk: string): SgrMouseEvent[];
}

/**
 * Chunked SGR parser. Non-mouse bytes are dropped; a partial SGR sequence
 * (`\u001b[<...` without a final byte) is held until completed.
 */
export function createMouseParser(): MouseParser {
  let pending = "";
  return {
    push(chunk: string): SgrMouseEvent[] {
      pending += chunk;
      const events: SgrMouseEvent[] = [];
      while (true) {
        // Drop any leading non-escape text.
        const escapeAt = pending.indexOf("\u001b");
        if (escapeAt > 0) pending = pending.slice(escapeAt);
        if (!pending.startsWith("\u001b")) {
          pending = "";
          break;
        }
        if (!pending.startsWith("\u001b[")) {
          // Lone ESC or a non-CSI escape — drop one byte and rescan.
          pending = pending.slice(1);
          continue;
        }
        const match = SGR_RE.exec(pending);
        if (!match) {
          if (pending.startsWith("\u001b[<")) {
            // Partial SGR sequence — wait for the rest. Cap against runaway input.
            if (pending.length > 32) pending = pending.slice(1);
            break;
          }
          // Some other CSI sequence (arrows etc.) — we don't handle it, drop a byte.
          pending = pending.slice(1);
          continue;
        }
        const complete = pending.slice(0, match[0].length);
        const ev = parseSgr(complete);
        if (ev) events.push(ev);
        pending = pending.slice(match[0].length);
      }
      return events;
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Intent mapping                                                            */
/* ------------------------------------------------------------------------- */

export type MouseIntent =
  | { kind: "scroll"; dir: 1 | -1 }
  | { kind: "set-cursor"; index: number }
  | { kind: "select-start"; row: number; col: number }
  | { kind: "select-extend"; row: number; col: number }
  | { kind: "select-finish" };

export interface MouseContext {
  /** Ignore all mouse intents while false (e.g. the palette is open). */
  active: boolean;
  /** 1-based terminal row of the input line. */
  inputRow: number;
  /** Current input length, for clamping the cursor. */
  inputLength: number;
  /** Columns before the editable text (left padding + prompt), default 7. */
  promptOffset?: number;
  /** 1-based terminal row of results row 0 (banner/info chrome above it). */
  viewportTop: number;
  /** Rows in the results viewport. */
  viewportRows: number;
  /**
   * 1-based terminal column of the card left border (results region col 1 +
   * the result pane's paddingX). Selection coordinates are card-local, where
   * col 0 is the border glyph.
   */
  resultLeft: number;
  /** Card width in columns; local columns clamp to [0, resultWidth). */
  resultWidth: number;
  /** True between select-start and release — a release then finishes the drag. */
  selectionActive: boolean;
}

/**
 * Map a 1-based terminal position into the 0-based, card-local results region.
 * Clamped per the plan: rows to [0, viewportRows), cols to [0, resultWidth).
 * Returns null when the region is collapsed (no rows or no width).
 */
function resultsPosition(ev: SgrMouseEvent, ctx: MouseContext): { row: number; col: number } | null {
  if (ctx.viewportRows <= 0 || ctx.resultWidth <= 0) return null;
  const row = Math.min(Math.max(0, ev.row - ctx.viewportTop), ctx.viewportRows - 1);
  const col = Math.min(Math.max(0, ev.col - ctx.resultLeft), ctx.resultWidth - 1);
  return { row, col };
}

/**
 * Map a parsed mouse event to an app intent (wheel scroll / click cursor /
 * drag-select start, extend and finish).
 */
export function classifyMouse(ev: SgrMouseEvent, ctx: MouseContext): MouseIntent | null {
  if (!ctx.active) return null;
  if (ev.kind === "wheel" && ev.wheelDir) {
    return { kind: "scroll", dir: ev.wheelDir };
  }
  if (ev.kind === "press" && ev.button === 0 && ev.row === ctx.inputRow) {
    return {
      kind: "set-cursor",
      index: colToCursorIndex(ev.col, ctx.inputLength, ctx.promptOffset),
    };
  }
  // Exact button 0 (no shift/ctrl modifiers): Shift+drag must stay native.
  if (ev.kind === "press" && ev.button === 0) {
    const pos = resultsPosition(ev, ctx);
    if (pos) return { kind: "select-start", ...pos };
  }
  // Only extend a drag that actually started (press on the input row then
  // dragging up into the results must not spawn a selection).
  if (ev.kind === "motion" && ctx.selectionActive && ev.heldButton === 0) {
    const pos = resultsPosition(ev, ctx);
    if (pos) return { kind: "select-extend", ...pos };
  }
  // Left release (plain 0 or drag-style 32) finishes; wheel releases (bit 6)
  // and non-left releases never do.
  if (
    ev.kind === "release" &&
    ctx.selectionActive &&
    (ev.button & 0x40) === 0 &&
    (ev.button & 0x1f) === 0
  ) {
    return { kind: "select-finish" };
  }
  return null;
}

/** 1-based terminal column → 0-based cursor index within the input line. */
export function colToCursorIndex(col: number, inputLength: number, promptOffset = 7): number {
  const index = col - 1 - promptOffset;
  return Math.min(Math.max(0, index), inputLength);
}