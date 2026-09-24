import { createElement } from "react";
import type { ReactNode } from "react";
import { Text } from "ink";
import { box } from "./el.ts";
import { resultHeights, scrollMax, clampScroll, visibleRange, type VisibleRange } from "./scroll.ts";
import type { ResultEntry } from "./state.ts";

export interface ResultPaneProps {
  results: readonly ResultEntry[];
  /** Effective, already-clamped scroll offset in content rows (0 = oldest first). */
  scrollTop: number | null;
  /** Exact rows this pane is allowed to occupy. */
  viewportRows: number;
  /** Card width in columns (border + padding included). */
  width: number;
}

export function ResultPane({ results, scrollTop, viewportRows, width }: ResultPaneProps) {
  if (results.length === 0) {
    return box(
      { paddingX: 1, paddingY: 1 },
      createElement(Text, { dimColor: true }, "No results yet — type a command, or press / for the palette."),
    );
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
