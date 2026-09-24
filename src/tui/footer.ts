import { createElement } from "react";
import { Text } from "ink";
import { box } from "./el.ts";

const HINTS = "↵ run · / palette · Tab · ↑↓ hist · PgUp/Dn · wheel · ^L clear · ^G guide · ^C exit";

export function Footer() {
  return box(
    { borderStyle: "single", borderDimColor: true, paddingX: 1 },
    // Truncate instead of wrapping: the footer must stay a fixed 2 rows so the
    // input line never shifts on narrow terminals.
    createElement(Text, { dimColor: true, wrap: "truncate" }, HINTS),
  );
}