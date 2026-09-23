import { createElement } from "react";
import { Text } from "ink";
import { box } from "./el.ts";

const HINTS = "↵ run · Tab complete · / palette · ↑↓ history · PgUp/PgDn results · ^L clear · ^C exit";

export function Footer() {
  return box(
    { borderStyle: "single", borderDimColor: true, paddingX: 1 },
    createElement(Text, { dimColor: true }, HINTS),
  );
}