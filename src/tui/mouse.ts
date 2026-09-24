/**
 * SGR (1006) mouse support for the TUI.
 *
 * The terminal is put into mouse-reporting mode with `?1000h` (press/release
 * and wheel events) and `?1006h` (SGR coordinates). Events arrive on stdin as
 * `ESC [ < button ; col ; row (M | m)` — press/wheel end in `M`, release in
 * `m`. Since sequences can be split across stdin chunks, `createMouseParser()`
 * buffers partial sequences until they complete.
 *
 * Ink's own input parser emits an unknown CSI sequence whole (input-parser.js
 * keeps buffering until the final byte), so the keymap can ignore mouse reports
 * by prefix (`isMouseSequence`) and they never leak into the input line.
 */

/** Enable press/release + wheel reporting with SGR coordinates. */
export const ENABLE_MOUSE = "\u001b[?1006h\u001b[?1000h";

/** Disable mouse reporting. */
export const DISABLE_MOUSE = "\u001b[?1006l\u001b[?1000l";

export interface SgrMouseEvent {
  kind: "press" | "release" | "wheel";
  /** Raw SGR button code (0 left, 1 middle, 2 right, 64 wheel-up, 65 wheel-down). */
  button: number;
  /** 1-based terminal column. */
  col: number;
  /** 1-based terminal row. */
  row: number;
  /** +1 = toward older results, -1 = toward newer — wheel events only. */
  wheelDir?: 1 | -1;
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
  | { kind: "set-cursor"; index: number };

export interface MouseContext {
  /** Ignore all mouse intents while false (e.g. the palette is open). */
  active: boolean;
  /** 1-based terminal row of the input line. */
  inputRow: number;
  /** Current input length, for clamping the cursor. */
  inputLength: number;
  /** Columns before the editable text (left padding + prompt), default 7. */
  promptOffset?: number;
}

/** Map a parsed mouse event to an app intent (wheel scroll / click cursor). */
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
  return null;
}

/** 1-based terminal column → 0-based cursor index within the input line. */
export function colToCursorIndex(col: number, inputLength: number, promptOffset = 7): number {
  const index = col - 1 - promptOffset;
  return Math.min(Math.max(0, index), inputLength);
}