import { createElement } from "react";
import type { ReactNode } from "react";
import { Text } from "ink";
import { box } from "./el.ts";

export interface GuideSection {
  title: string;
  lines: readonly string[];
}

export interface GuideContentArgs {
  version: string;
  commands: readonly string[];
  elementCount: number;
}

/** Curated guide content — pure and testable. Lines are ≤ 26 content cols:
 * the guide's inner width is guideWidth − 2 (border) − 2 (paddingX), and the
 * minimum guideWidth is 30 → 26 columns. Anything longer would wrap and grow
 * the panel, so lines are deliberately terse. */
export function guideSections({ version, commands, elementCount }: GuideContentArgs): GuideSection[] {
  return [
    {
      title: "Commands",
      lines: [
        ...commands,
        "? — 'help' for detail",
        "classify/predict — M3+",
      ],
    },
    {
      title: "Keys",
      lines: [
        "↵ run input",
        "/ command palette",
        "Tab complete commands",
        "↑ ↓ command history",
        "PgUp/Dn · wheel scroll",
        "click input → caret",
        "drag results → copy",
        "^L clear results",
        "^G show/hide this guide",
        "^C exit",
      ],
    },
    {
      title: "Engine",
      lines: [
        `v${version} · fully offline`,
        `${elementCount} elements embedded`,
        "exact rational balancer",
        "no network · no scraping",
      ],
    },
  ];
}

export interface GuideProps {
  sections: readonly GuideSection[];
  width: number;
}

export function Guide({ sections, width }: GuideProps) {
  const children: ReactNode[] = [createElement(Text, { bold: true, color: "cyan" }, "GUIDE")];
  for (const section of sections) {
    children.push(createElement(Text, { bold: true }, section.title));
    for (const line of section.lines) {
      children.push(createElement(Text, { dimColor: true }, line));
    }
  }
  // overflowY hidden + flexShrink 1: the guide's natural height can never
  // grow the shared row, so tall content can't push the input line around.
  return box(
    {
      flexDirection: "column",
      width,
      borderStyle: "single",
      borderColor: "cyan",
      paddingX: 1,
      paddingY: 1,
      overflowY: "hidden",
      flexShrink: 1,
    },
    ...children,
  );
}