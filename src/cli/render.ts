import type { BalancedEquation } from "../core/balance.ts";
import { formatBalancedEquation } from "../core/balance.ts";
import { molarMassFromCounts } from "../core/formula.ts";
import type { ElementData } from "../core/elements.ts";
import type { Classification, SpeciesClass } from "../knowledge/classify.ts";
import { components } from "../structure/molecule.ts";
import { findTemplates } from "../structure/templates.ts";

type Style = "bold" | "dim" | "red" | "green" | "yellow" | "cyan";

const CODES: Record<Style, string> = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

/** ANSI color only when attached to a TTY (and NO_COLOR is unset); plain when piped. */
export function isTty(): boolean {
  return !!process.stdout?.isTTY && !process.env["NO_COLOR"];
}

export function paint(text: string, style: Style): string {
  return isTty() ? `${CODES[style]}${text}\x1b[0m` : text;
}

export function renderBalanced(b: BalancedEquation): string {
  const lines: string[] = [formatBalancedEquation(b), ""];
  lines.push(paint("Stoichiometry:", "bold"));
  const species = [...b.equation.reactants, ...b.equation.products];
  for (let i = 0; i < species.length; i++) {
    const sp = species[i]!;
    const coeff = b.coefficients[i]!;
    const mass = molarMassFromCounts(sp.counts);
    lines.push(
      `  ${coeff} x ${sp.formula.padEnd(12)}${sp.state !== undefined ? `(${sp.state}) ` : ""}${mass.toFixed(3)} g/mol`,
    );
  }
  lines.push("");
  lines.push(paint("Conserved elements:", "bold") + ` ${b.elements.join(", ")}`);
  return lines.join("\n");
}

export function renderElement(el: ElementData): string {
  return `  ${el.symbol.padEnd(3)} ${el.name.padEnd(14)} atomic #${el.number}  ${el.mass} g/mol`;
}

/** "carboxylic-acid" reads as words on a card, not as an identifier. */
const CLASS_LABELS: Readonly<Record<SpeciesClass, string>> = {
  "carboxylic-acid": "carboxylic acid",
  acid: "acid",
  base: "base",
  salt: "salt",
  metal: "metal",
  oxide: "oxide",
  hydroxide: "hydroxide",
  water: "water",
  peroxide: "peroxide",
  element: "element",
  hydrocarbon: "hydrocarbon",
  alcohol: "alcohol",
  aldehyde: "aldehyde",
  ketone: "ketone",
  ester: "ester",
  ether: "ether",
  amine: "amine",
  aromatic: "aromatic",
  hydrate: "hydrate",
};

/** The classification card: the label, the evidence for it, and how it was built. */
export function renderClassification(result: Classification): string {
  const lines: string[] = [];
  // A curated formula is shown the way a chemist writes it (H2SO4, not the Hill
  // key H2O4S); anything the engine worked out for itself is shown as computed.
  const curated = result.structure.source === "template" ? findTemplates(result.formula)[0] : undefined;
  const shown = curated?.formula ?? result.formula;
  const name = curated?.name;
  const header = `  ${paint(shown, "bold")}${name === undefined ? "" : ` — ${paint(name, "cyan")}`}`;
  const headerWidth = 2 + shown.length + (name === undefined ? 0 : 3 + name.length);
  lines.push(`${header}${" ".repeat(Math.max(1, 44 - headerWidth))}${result.molarMass.toFixed(3)} g/mol`);
  lines.push("");

  if (result.classes.length === 0) {
    lines.push(`  ${paint("unknown", "yellow")} — nothing in it matched a class we know`);
  } else {
    const [primary, ...rest] = result.classes;
    lines.push(`  ${paint(CLASS_LABELS[primary!], "bold")}`);
    for (let i = 0; i < result.reasoning.length; i++) {
      const label = result.classes.length > 1 ? `${CLASS_LABELS[result.classes[i]!]}: ` : "";
      lines.push(`    ${label}${result.reasoning[i]}`);
    }
    if (rest.length > 0) {
      lines.push("");
      lines.push(`  also ${rest.map((c) => CLASS_LABELS[c]).join(", ")}`);
    }
  }
  lines.push("");

  const build = result.structure;
  const shape =
    build.molecule === null
      ? "no connectivity"
      : `${plural(build.molecule.atoms.length, "atom", "atoms")} in ${plural(
          components(build.molecule).length,
          "particle",
          "particles",
        )}`;
  lines.push(`${paint("Structure:", "bold")}  ${build.source} · ${build.confidence} confidence · ${shape}`);
  // A template build's second note is the "one formula, two molecules" warning,
  // which the classification already reports under Limits; repeating it would be
  // the same sentence twice in one card.
  const notes = build.source === "template" ? build.notes.slice(0, 1) : build.notes;
  for (const note of notes) lines.push(`    ${note}`);

  if (result.caveats.length > 0) {
    lines.push("");
    lines.push(paint("Limits:", "bold"));
    for (const caveat of result.caveats) lines.push(`    ${caveat}`);
  }
  return lines.join("\n");
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}