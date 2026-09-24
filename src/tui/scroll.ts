import wrapAnsi from "wrap-ansi";
import type { ResultEntry } from "./state.ts";

/**
 * Row-based scroll math for the center results viewport.
 *
 * Result cards have variable heights (their output text wraps), so scrolling
 * pages by *rows* (not by card count). Heights are exact: Ink wraps Text nodes
 * with `wrap-ansi(text, width, { trim: false, hard: true })` (see
 * ink/build/wrap-text.js), so the same call gives the true rendered line count.
 */

/** Rows a single wheel notch scrolls. */
export const WHEEL_STEP = 3;

/** Card chrome rows beyond the body: 2 borders + 2 paddingY + 1 header line. */
const CARD_CHROME_ROWS = 2 + 2 + 1;

/** Number of rows `text` occupies once wrapped at `width` (Ink's default wrap). */
export function wrappedLines(text: string, width: number): number {
  const inner = Math.max(1, width);
  return wrapAnsi(text, inner, { trim: false, hard: true }).split("\n").length;
}

/**
 * Exact rendered height of one result card.
 * `width` is the card's outer width incl. its border; content wraps at
 * `width - 2 (border) - 2 (paddingX)`.
 */
export function cardRows(header: string, body: string, width: number): number {
  const inner = Math.max(1, width - 4);
  return CARD_CHROME_ROWS + wrappedLines(header, inner) + wrappedLines(body, inner);
}

/**
 * Per-card heights (rows). The card container uses `gap: 1`, so every card but
 * the last contributes one extra gap row — this keeps cumulative offsets exact.
 */
export function resultHeights(results: readonly ResultEntry[], width: number): number[] {
  const heights: number[] = new Array(results.length);
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const rows = cardRows(`#${r.id} $ ${r.command}`, r.output, width);
    heights[i] = i < results.length - 1 ? rows + 1 : rows;
  }
  return heights;
}

/** Farthest scroll offset (rows) that still shows the newest content. */
export function scrollMax(heights: readonly number[], viewportRows: number): number {
  const total = heights.reduce((sum, h) => sum + h, 0);
  return Math.max(0, total - viewportRows);
}

export function clampScroll(top: number, max: number): number {
  return Math.min(Math.max(0, top), max);
}

export interface VisibleRange {
  /** First card index at least partially inside the window. */
  start: number;
  /** One past the last card at least partially inside the window. */
  end: number;
}

/**
 * Cards to render for a window showing content rows `[top, top + viewportRows)`.
 * Cards straddling either edge are included and clipped by the viewport.
 */
export function visibleRange(top: number, heights: readonly number[], viewportRows: number): VisibleRange {
  const limit = top + viewportRows;
  let start = heights.length;
  let end = heights.length;
  let cumulative = 0;
  for (let i = 0; i < heights.length; i++) {
    const rowEnd = cumulative + heights[i]!;
    if (start === heights.length && rowEnd > top) start = i;
    if (end === heights.length && cumulative >= limit) end = i;
    cumulative = rowEnd;
  }
  return { start, end };
}

/** PgUp/PgDn page size: one viewport, minus a row so pages don't overlap edges. */
export function pageStep(viewportRows: number): number {
  return Math.max(1, viewportRows - 1);
}