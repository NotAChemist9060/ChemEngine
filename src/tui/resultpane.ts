import { createElement } from "react";
import type { ReactNode } from "react";
import { Text } from "ink";
import { box } from "./el.ts";
import { buildScreenLines, resultHeights, scrollMax, clampScroll, visibleRange, type VisibleRange } from "./scroll.ts";
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
   * Active drag selection (viewport-local). When non-null the pane renders the
   * screen-line grid with per-cell inverse highlight instead of card boxes —
   * the same rows `buildScreenLines` models, so selection matches extraction.
   */
  selection?: Selection | null;
}

/** Box-drawn glyphs of the round border style — these carry the card's border color. */
const BORDER_GLYPHS = new Set(["╭", "╮", "╰", "╯", "│", "─"]);

/**
 * Selection render path: one `<Text>` per screen-model row, split into runs by
 * per-cell style. The non-selected cells must be byte-identical to the card-box
 * path (so switching paths mid-drag never reflows the pane):
 *
 * - selected cells → flat `inverse` (the highlight is the background swap;
 *   no color/dim so it stays readable on any row);
 * - box border glyphs (`╭╮╰╯│─`) → the card's `border` color, never dim;
 * - everything else (padding, header/body text, marker) → `dim` on dim rows
 *   (headers, marker), otherwise default.
 */
function renderSelectionLines(
  results: readonly ResultEntry[],
  scrollTop: number | null,
  viewportRows: number,
  width: number,
  selection: Selection,
): ReactNode {
  const lines = buildScreenLines(results, scrollTop, viewportRows, width);
  const rows: ReactNode[] = lines.map((line) => {
    const styleOf = (i: number): { selected: boolean; glyph: boolean; dim: boolean } => {
      const selected = selectionCell(selection, line.row, i);
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

  if (selection) {
    return renderSelectionLines(results, scrollTop, viewportRows, width, selection);
  }

  // A scrolled-off region reserves one marker row at the top of the pane; the
  // cards then occupy the remaining `cardViewportRows`, so cumulative offsets
  // stay exact and the marker never steals a card row.
  const markerRows = scrollTop !== null && scrollTop > 0 ? 1 : 0;
  const cardViewport = Math.max(1, viewportRows - markerRows);
  const heights = resultHeights(results, Math.max(1, width));
  const max = scrollMax(heights, cardViewport);
  const top = scrollTop === null ? max : clampScroll(scrollTop, max);
  const range: VisibleRange = visibleRange(top, heights, cardViewport);
  const visible = results.slice(range.start, range.end);

  const cards: ReactNode[] = visible.map((entry) =>
    box(
      {
        key: entry.id,
        flexDirection: "column",
        borderStyle: "round",
        borderColor: entry.ok ? "green" : "red",
        paddingX: 1,
        paddingY: 1,
        width,
      },
      createElement(Text, { dimColor: true }, `#${entry.id} $ ${entry.command}`),
      createElement(Text, {}, entry.output),
    ),
  );

  if (top > 0) {
    cards.unshift(
      createElement(
        Text,
        { dimColor: true, wrap: "truncate" },
        `▲ ${top} rows above — scroll down`,
      ),
    );
  }

  return box({ flexDirection: "column", paddingX: 1, gap: 1 }, ...cards);
}
