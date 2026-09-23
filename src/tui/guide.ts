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

/** Curated guide content — pure and testable. */
export function guideSections({ version, commands, elementCount }: GuideContentArgs): GuideSection[] {
  return [
    {
      title: "Commands",
      lines: [
        ...commands.map((c) => `${c} — type 'help' for detail`),
        "classify · predict · simulate — coming in M3–M5",
      ],
    },
    {
      title: "Keys",
      lines: [
        "↵ run input",
        "/ command palette",
        "Tab complete (commands → elements)",
        "↑ ↓ command history",
        "PgUp / PgDn scroll results",
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
  return box({ flexDirection: "column", width, borderStyle: "single", borderColor: "cyan", paddingX: 1, paddingY: 1 }, ...children);
}