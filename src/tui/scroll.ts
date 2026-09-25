import wrapAnsi from "wrap-ansi";
import {
  blankDisplayLine,
  joinDisplayLines,
  makeDisplayLine,
  padDisplayLine,
  truncateDisplayLine,
  type DisplayLine,
} from "./display.ts";
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

/** Rows reserved above scrolled content: the marker text plus its spacer. */
export const MARKER_ROWS = 2;

/**
 * Card chrome rows beyond the wrapped header/body: 2 borders + 2 paddingY.
 * (The header line is counted separately via `wrappedLines(header)`; counting
 * it here too would overcount every card by one row.)
 */
const CARD_CHROME_ROWS = 2 + 2;

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
  return scrollGeometry(heights, viewportRows, null).max;
}

export function clampScroll(top: number, max: number): number {
  return Math.min(Math.max(0, top), max);
}

/**
 * Normalize a scroll offset against the current maximum. `null` is the
 * bottom-pinned autoscroll sentinel; an offset that reaches the bottom also
 * re-pins to `null` so state and rendering use one representation of the pin.
 */
export function normalizeScrollTop(top: number | null, max: number): number | null {
  if (top === null) return null;
  const bottom = Math.max(0, max);
  const next = clampScroll(top, bottom);
  return next >= bottom ? null : next;
}

export interface VisibleRange {
  /** First card index at least partially inside the window. */
  start: number;
  /** One past the last card at least partially inside the window. */
  end: number;
}

/**
 * One resolved scroll window. Every consumer (max calculation, reducer
 * clamping, card selection, and screen-line rendering) derives from this
 * shape, so marker space cannot drift away from the content window.
 */
export interface ScrollGeometry {
  /** Total content rows, including inter-card gap rows. */
  totalRows: number;
  /** Maximum valid content offset for this viewport. */
  max: number;
  /** Effective content offset after resolving `null` and clamping. */
  top: number;
  /** Marker rows actually shown above the content (0 at the very top). */
  markerRows: number;
  /** Content rows visible after marker rows are reserved. */
  contentRows: number;
  /** Cards intersecting the effective content window. */
  range: VisibleRange;
}

/**
 * Resolve a requested offset into the single geometry used by rendering and
 * scrolling. When content overflows the viewport, any non-zero window reserves
 * the marker and its spacer, so the true bottom is `totalRows` rather than a
 * card's first row.
 */
export function scrollGeometry(
  heights: readonly number[],
  viewportRows: number,
  scrollTop: number | null,
): ScrollGeometry {
  const rowCount = Math.max(0, Math.trunc(viewportRows));
  const totalRows = heights.reduce((sum, h) => sum + h, 0);
  const overflows = totalRows > rowCount;
  // Tiny viewports cannot show a marker and content together; leave the marker
  // off there rather than spending the whole viewport on chrome.
  const reservedMarkerRows = overflows && rowCount > MARKER_ROWS ? MARKER_ROWS : 0;
  const max = overflows
    ? Math.max(0, totalRows - Math.max(0, rowCount - reservedMarkerRows))
    : 0;
  const top = scrollTop === null ? max : clampScroll(scrollTop, max);
  const markerRows = top > 0 ? reservedMarkerRows : 0;
  const contentRows = Math.max(0, rowCount - markerRows);
  const range =
    contentRows > 0
      ? visibleRange(top, heights, contentRows)
      : { start: heights.length, end: heights.length };
  return { totalRows, max, top, markerRows, contentRows, range };
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

/* ------------------------------------------------------------------------- */
/* Screen-line model                                                         */
/* ------------------------------------------------------------------------- */

/**
 * One rendered row of the results region, in *viewport-local* coordinates
 * (row 0 = the top of the center region, regardless of banner/info chrome).
 * `text` is plain visible content with no ANSI codes; `cells` carries the
 * display-column metadata used by the renderer and selection extractor.
 */
export interface PaneLine {
  /** 0-based row within the results viewport. */
  row: number;
  /** Plain visible text (borders/padding/gaps included), padded by display columns. */
  text: string;
  /** Optional normalized cells; older test/manual lines may omit them. */
  cells?: readonly import("./display.ts").DisplayCell[];
  /** Card border color when this row belongs to a result card. */
  border?: "green" | "red";
  /** Dim styling (scrolled-off marker row, or a card header row). */
  dim?: boolean;
  /** False for marker/gap rows — excluded from selection extraction. */
  card: boolean;
}

/** Ink round-border glyphs (borderStyle: "round"). */
const ROUND = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };

/** Text wrapped exactly like Ink's Text default (hard wrap, no trim). */
function wrapLines(text: string, inner: number): DisplayLine[] {
  return wrapAnsi(text, Math.max(1, inner), { trim: false, hard: true })
    .split("\n")
    .map((line) => makeDisplayLine(line, Math.max(1, inner)));
}

/** One card row: normalized display cells plus styling flags for the line model. */
interface CardRow {
  line: DisplayLine;
  /** Header rows render dim. */
  dim?: boolean;
}

/** Full rendered row lines of one card (border included), exactly `width` cols. */
function cardTextLines(entry: ResultEntry, width: number): CardRow[] {
  const w = Math.max(1, width);
  const inner = Math.max(1, w - 4); // width - 2 borders - 2 paddingX
  const pad = blankDisplayLine(inner);
  const mid = (content: DisplayLine): DisplayLine =>
    joinDisplayLines(
      [
        makeDisplayLine(ROUND.v, 1),
        blankDisplayLine(1),
        padDisplayLine(content, inner),
        blankDisplayLine(1),
        makeDisplayLine(ROUND.v, 1),
      ],
      w,
    );
  return [
    { line: makeDisplayLine(`${ROUND.tl}${ROUND.h.repeat(Math.max(0, w - 2))}${ROUND.tr}`, w) },
    { line: mid(pad) },
    ...wrapLines(`#${entry.id} $ ${entry.command}`, inner).map((line) => ({ line: mid(line), dim: true })),
    ...wrapLines(entry.output, inner).map((line) => ({ line: mid(line) })),
    { line: mid(pad) },
    { line: makeDisplayLine(`${ROUND.bl}${ROUND.h.repeat(Math.max(0, w - 2))}${ROUND.br}`, w) },
  ];
}

/**
 * The exact rows the results pane would render for a window, as plain lines.
 *
 * Mirrors `ResultPane`'s layout: when rows are scrolled off, a dim marker row
 * and one flex-gap row precede the cards (cards then start at viewport row 2);
 * the inter-card gap is one row per card except the last; the pane is clipped
 * to `viewportRows`. The output is always exactly `viewportRows` lines — rows
 * past the content are blank — so callers can index by viewport-local row.
 */
export function buildScreenLines(
  results: readonly ResultEntry[],
  scrollTop: number | null,
  viewportRows: number,
  width: number,
): PaneLine[] {
  const rowCount = Math.max(0, Math.trunc(viewportRows));
  const lineWidth = Math.max(0, Math.trunc(width));
  const blank = (w: number): DisplayLine => blankDisplayLine(Math.max(0, w));
  if (results.length === 0 || rowCount <= 0) {
    return Array.from({ length: rowCount }, (_, row) => {
      const line = blank(lineWidth);
      return { row, text: line.text, cells: line.cells, card: false };
    });
  }
  const heights = resultHeights(results, Math.max(1, lineWidth));
  const geometry = scrollGeometry(heights, rowCount, scrollTop);
  const { markerRows, range, top } = geometry;

  const lines: PaneLine[] = [];
  const push = (row: number, line: DisplayLine, extra: Omit<Partial<PaneLine>, "row" | "text" | "cells"> = {}): void => {
    lines.push({ row, text: line.text, cells: line.cells, card: extra.card ?? false, ...extra });
  };

  if (markerRows > 0) {
    // Ink's wrap:"truncate" reserves the last column for the ellipsis glyph.
    const markerText = `▲ ${top} rows above — scroll down`;
    push(0, truncateDisplayLine(markerText, lineWidth), { dim: true });
    push(1, blank(lineWidth));
  }
  // Emit the visible cards, starting `top` rows into the content so the window
  // [top, top + contentRows) matches the rows actually on screen. `cum` tracks
  // each card's content-row offset in heights space (trailing gap included).
  // The loop only visits cards ≥ range.start, so `cum` must begin at that
  // card's offset (the sum of every row before it) — counting from 0 made
  // every mid-stack window skip the wrong cards (blank rows or newer cards
  // pulled forward) whenever the first card was scrolled off-screen.
  let cum = heights.slice(0, range.start).reduce((sum, h) => sum + h, 0);
  for (let i = range.start; i < range.end && lines.length < rowCount; i++) {
    const entry = results[i]!;
    const border = entry.ok ? "green" : "red";
    const cardLines = cardTextLines(entry, lineWidth);
    const gapRow = i < results.length - 1 ? 1 : 0;
    const skip = Math.max(0, Math.min(top - cum, cardLines.length));
    for (let k = skip; k < cardLines.length && lines.length < rowCount; k++) {
      const cardLine = cardLines[k]!;
      push(lines.length, cardLine.line, { border, card: true, ...(cardLine.dim ? { dim: true } : {}) });
    }
    if (gapRow && lines.length < rowCount) push(lines.length, blank(lineWidth));
    cum += cardLines.length + gapRow;
  }
  const out = lines.slice(0, rowCount);
  while (out.length < rowCount) {
    const line = blank(lineWidth);
    out.push({ row: out.length, text: line.text, cells: line.cells, card: false });
  }
  return out.map((l, i) => ({ ...l, row: i }));
}