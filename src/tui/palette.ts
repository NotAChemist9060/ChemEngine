import { createElement } from "react";
import { Text } from "ink";
import { box } from "./el.ts";
import type { PaletteItem } from "./palette-list.ts";

export interface PaletteProps {
  items: readonly PaletteItem[];
  index: number;
  query: string;
}

const MAX_ROWS = 10;

export function Palette({ items, index, query }: PaletteProps) {
  const shown = items.slice(0, MAX_ROWS);
  const rows = shown.map((item, i) => {
    const active = i === index % Math.max(items.length, 1);
    return active
      ? createElement(
          Text,
          { key: item.name, color: "magenta", inverse: true },
          `> ${item.name}`,
          createElement(Text, { dimColor: true }, `  ${item.summary}`),
        )
      : createElement(
          Text,
          { key: item.name },
          `  ${item.name}`,
          createElement(Text, { dimColor: true }, `  ${item.summary}`),
        );
  });

  if (items.length === 0) {
    rows.push(createElement(Text, { dimColor: true }, `no matches for “${query}”`));
  }

  return box(
    { borderStyle: "round", borderColor: "magenta", flexDirection: "column", paddingX: 1, paddingY: 1, marginX: 1 },
    createElement(Text, { dimColor: true }, `/${query} `),
    ...rows,
  );
}