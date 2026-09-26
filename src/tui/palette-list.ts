import { COMMANDS } from "../cli/commands.ts";

export interface PaletteItem {
  name: string;
  summary: string;
}

/**
 * Everything reachable from the command palette. The planned list is deliberately
 * short and *only* holds what COMMANDS does not: a name in both lists would show
 * up twice, which is the kind of small wrongness a palette should not have.
 */
export function paletteItems(): PaletteItem[] {
  const meta: PaletteItem[] = [
    { name: "help", summary: "Show help — 'help <command>' for detail" },
    { name: "examples", summary: "Run through demo commands live" },
    { name: "clear", summary: "Clear result history" },
    { name: "version", summary: "Print the version" },
    { name: "exit", summary: "Leave ChemEngine" },
  ];
  const planned: PaletteItem[] = [
    { name: "predict", summary: "Predict reactions from reactants" },
    { name: "simulate", summary: "Simulate reaction kinetics" },
  ];
  return [
    ...meta,
    ...COMMANDS.map((c) => ({ name: c.name, summary: c.summary })),
    ...planned,
  ];
}

/** Case-insensitive substring filter over name + summary. */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return items;
  return items.filter((it) => it.name.toLowerCase().includes(q) || it.summary.toLowerCase().includes(q));
}