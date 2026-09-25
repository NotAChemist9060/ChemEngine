import {
  displayWidth,
  makeDisplayLine,
  sliceDisplayLine,
  type DisplayLine,
} from "./display.ts";
import type { PaneLine } from "./scroll.ts";

/**
 * Rectangular text selection over the results viewport, in *viewport-local*
 * 0-based coordinates (row 0 = top of the center region, col 0 = the card
 * frame's left border column).
 *
 * `anchor` is fixed at drag start; `active` tracks the pointer. The selected
 * box is the inclusive rectangle spanned by both corners (see `normalizedBox`).
 */
export interface Selection {
  anchorRow: number;
  anchorCol: number;
  activeRow: number;
  activeCol: number;
}

/** Create a fresh selection pinned at a single cell (anchor = active). */
export function startSelection(row: number, col: number): Selection {
  return { anchorRow: row, anchorCol: col, activeRow: row, activeCol: col };
}

/** Move only the active corner; the anchor stays put. Returns a new object. */
export function extendSelection(sel: Selection, row: number, col: number): Selection {
  return { ...sel, activeRow: row, activeCol: col };
}

/** The inclusive rectangle spanned by the selection's two corners. */
export interface SelectionBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Normalize corners so top ≤ bottom and left ≤ right (both inclusive). */
export function normalizedBox(sel: Selection): SelectionBox {
  return {
    top: Math.min(sel.anchorRow, sel.activeRow),
    bottom: Math.max(sel.anchorRow, sel.activeRow),
    left: Math.min(sel.anchorCol, sel.activeCol),
    right: Math.max(sel.anchorCol, sel.activeCol),
  };
}

/** A selection with any area (anchor and active differ in at least one axis). */
export function hasArea(sel: Selection): boolean {
  return sel.anchorRow !== sel.activeRow || sel.anchorCol !== sel.activeCol;
}

/** True when the given viewport-local cell lies inside the inclusive box. */
export function selectionCell(sel: Selection, row: number, col: number): boolean {
  const box = normalizedBox(sel);
  return row >= box.top && row <= box.bottom && col >= box.left && col <= box.right;
}

function displayLineFor(line: PaneLine): DisplayLine {
  if (line.cells !== undefined) {
    return { text: line.text, cells: line.cells, width: displayWidth(line.text) };
  }
  return makeDisplayLine(line.text, displayWidth(line.text));
}

/**
 * The plain text a selection captures from rendered screen lines.
 *
 * Per selected row (inside the inclusive box): card rows contribute the
 * display-column slice `[left, right]` with trailing whitespace trimmed;
 * non-card rows contribute a blank line when they are visually blank (the
 * inter-card gap / bottom fill — preserving the on-screen separator between
 * two cards) and are skipped entirely when they carry UI text (the dim
 * "rows above" marker). ANSI controls and JS UTF-16 indexes never enter the
 * copied string.
 */
export function extractSelectionText(lines: readonly PaneLine[], sel: Selection): string {
  const box = normalizedBox(sel);
  const rows: string[] = [];
  for (let row = box.top; row <= box.bottom; row++) {
    const line = lines[row];
    if (!line) continue; // box extends past the viewport's rows
    const displayLine = displayLineFor(line);
    if (!line.card) {
      if (displayLine.text.trim() === "") rows.push(""); // gap/padding → blank line
      continue; // marker row → excluded entirely
    }
    rows.push(sliceDisplayLine(displayLine, box.left, box.right).trimEnd());
  }
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows.join("\n");
}