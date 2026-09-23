import { createElement } from "react";
import type { ReactNode } from "react";
import { Text } from "ink";
import { box } from "./el.ts";
import type { ResultEntry } from "./state.ts";

export interface ResultPaneProps {
  results: readonly ResultEntry[];
  limit: number;
  scrollOffset: number;
}

export function ResultPane({ results, limit, scrollOffset }: ResultPaneProps) {
  if (results.length === 0) {
    return box(
      { paddingX: 1, paddingY: 1 },
      createElement(Text, { dimColor: true }, "No results yet — type a command, or press / for the palette."),
    );
  }
  const end = results.length - scrollOffset;
  const start = Math.max(0, end - limit);
  const visible = results.slice(start, end);

  const cards: ReactNode[] = visible.map((r) =>
    box(
      {
        key: r.id,
        flexDirection: "column",
        borderStyle: "round",
        borderColor: r.ok ? "green" : "red",
        paddingX: 1,
        paddingY: 1,
      },
      createElement(Text, { dimColor: true }, `#${r.id} $ ${r.command}`),
      createElement(Text, {}, r.output),
    ),
  );

  if (scrollOffset > 0) {
    cards.unshift(
      createElement(
        Text,
        { dimColor: true },
        `… ${scrollOffset} older result${scrollOffset === 1 ? "" : "s"} (▼ scroll down)`,
      ),
    );
  }

  return box({ flexDirection: "column", paddingX: 1, gap: 1 }, ...cards);
}