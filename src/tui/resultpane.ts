import { createElement } from "react";
import type { ReactNode } from "react";
import { Text } from "ink";
import { box } from "./el.ts";
import { buildScreenLines } from "./scroll.ts";
import { selectionCell, type Selection } from "./select.ts";
import type { ResultEntry } from "./state.ts";

export interface ResultPaneProps {
  results: readonly ResultEntry[];
  /** Effective, already-clamped scroll offset in content rows (0 = oldest first). */
  scrollTop: number | null;
  /** Exact rows this pane is allowed to occupy. */
  viewportRows: number;
  /** Card width in columns (border + padding included). */
  width: number;
  /**
   * Active drag selection (viewport-local). The pane renders one screen-line
   * grid in both states — the same rows `buildScreenLines` models — and the
   * selection only changes per-cell styles, so switching into a drag never
   * reflows the pane and selection always matches extraction.
   */
  selection?: Selection | null;
}

/** Box-drawn glyphs of the round border style — these carry the card's border color. */
const BORDER_GLYPHS = new Set(["╭", "╮", "╰", "╯", "│", "─"]);

/**
 * Screen-line render path: one `<Text>` per `buildScreenLines` row, split into
 * runs by per-cell style:
 *
 * - selected cells → flat `inverse` (the highlight is the background swap;
 *   no color/dim so it stays readable on any row);
 * - box border glyphs (`╭╮╰╯│─`) → the card's `border` color, never dim;
 * - everything else (padding, header/body text, marker) → `dim` on dim rows
 *   (headers, marker), otherwise default.
 *
 * With no selection every cell takes the plain glyph/dim/default styling, which
 * is byte-identical to the pre-unification card-box path (guarded by the
 * screen-lines parity tests), so the pane renders identically idle or dragging.
 */
function renderGrid(
  results: readonly ResultEntry[],
  scrollTop: number | null,
  viewportRows: number,
  width: number,
  selection: Selection | null,
): ReactNode {
  const lines = buildScreenLines(results, scrollTop, viewportRows, width);
  const rows: ReactNode[] = lines.map((line) => {
    const styleOf = (i: number): { selected: boolean; glyph: boolean; dim: boolean } => {
      const selected = selection !== null && selectionCell(selection, line.row, i);
      return {
        selected,
        glyph: line.card ? BORDER_GLYPHS.has(line.text[i] ?? "") : false,
        dim: line.dim === true && !selected,
      };
    };
    const spans: ReactNode[] = [];
    let col = 0;
    while (col < line.text.length) {
      const st = styleOf(col);
      let end = col + 1;
      while (end < line.text.length) {
        const s2 = styleOf(end);
        if (s2.selected !== st.selected || s2.glyph !== st.glyph || s2.dim !== st.dim) break;
        end++;
      }
      const chunk = line.text.slice(col, end);
      const key = `c${col}`;
      if (st.selected) {
        spans.push(createElement(Text, { key, inverse: true }, chunk));
      } else if (st.glyph && line.border) {
        spans.push(createElement(Text, { key, color: line.border }, chunk));
      } else if (st.dim) {
        spans.push(createElement(Text, { key, dimColor: true }, chunk));
      } else {
        spans.push(createElement(Text, { key }, chunk));
      }
      col = end;
    }
    return createElement(Text, { key: `row${line.row}` }, ...spans);
  });
  return box({ flexDirection: "column", paddingX: 1 }, ...rows);
}

export function ResultPane({ results, scrollTop, viewportRows, width, selection }: ResultPaneProps) {
  if (results.length === 0) {
    return box(
      { paddingX: 1, paddingY: 1 },
      createElement(Text, { dimColor: true }, "No results yet — type a command, or press / for the palette."),
    );
  }
  return renderGrid(results, scrollTop, viewportRows, width, selection ?? null);
}
