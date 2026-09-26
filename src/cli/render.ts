import type { BalancedEquation } from "../core/balance.ts";
import { formatBalancedEquation } from "../core/balance.ts";
import { molarMassFromCounts } from "../core/formula.ts";
import type { ElementData } from "../core/elements.ts";
import type { Classification, SpeciesClass } from "../knowledge/classify.ts";
import { components } from "../structure/molecule.ts";
import { findTemplates } from "../structure/templates.ts";
import { explain, type Feasibility, type Verdict } from "../thermo/feasibility.ts";
import type { ReactionGibbs } from "../thermo/thermo.ts";
import type { Candidate, Declined } from "../rules/types.ts";

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

/*
 * ── Reaction cards ─────────────────────────────────────────────────────────
 * The `predict` and `feasibility` commands' output. Cards show the balanced
 * equation *spelled the way it was written* (MgO, not the Hill-order MgO — and
 * for a salt, NaCl, not ClNa), the ΔG-backed verdict, and the rule's one-line
 * why. When piped (tests, scripts) paint() strips the colors and the layout is
 * plain text; on a TTY the verdict gets its own color.
 */

const VERDICT_COLORS: Record<Verdict, Style> = {
  spontaneous: "green",
  marginal: "cyan",
  nonspontaneous: "yellow",
  unknown: "red",
};

/** The arrow the engine writes; feasibility accepts <=> too. */
const ARROW = /(<=>|->)/;

function sideParts(text: string): { left: string[]; right: string[] } | undefined {
  const m = ARROW.exec(text);
  if (m === null) return undefined;
  return {
    left: text
      .slice(0, m.index)
      .split("+")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
    right: text
      .slice(m.index + m[0].length)
      .split("+")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  };
}

/**
 * A balanced equation rendered with the author's spelling of each species and
 * the balancer's smallest-integer coefficients. Falls back to the canonical
 * render when the text cannot be split side-by-side, so a malformed proposal
 * still prints something truthful.
 */
/** A leading coefficient already written in a term ("2H2O") must not double up. */
const WRITTEN_COEFFICIENT = /^\d+\s*\/\s*\d+|^\.\d+|^\d+(?:\.\d+)?/;

export function renderFriendlyBalanced(text: string, balanced: BalancedEquation): string {
  const parts = sideParts(text);
  const n = balanced.equation.reactants.length;
  if (parts === undefined || parts.left.length !== n || parts.right.length !== balanced.equation.products.length) {
    return formatBalancedEquation(balanced);
  }
  const side = (friendly: string[], start: number): string =>
    friendly
      .map((f, i) => {
        const k = balanced.coefficients[start + i]!;
        const bare = f.replace(WRITTEN_COEFFICIENT, "").trim();
        return k === 1 ? bare : `${k}${bare}`;
      })
      .join(" + ");
  const arrow = balanced.equation.reversible ? "<=>" : "->";
  return `${side(parts.left, 0)} ${arrow} ${side(parts.right, n)}`;
}

/** One numbered candidate card: the verdict atop the balanced equation. */
function renderCandidateCard(index: number, f: Feasibility): string {
  return [
    `${index}. ${paint(f.rule, "cyan")} — ${paint(f.verdict, VERDICT_COLORS[f.verdict])}`,
    `   ${renderFriendlyBalanced(f.proposed, f.balanced)}`,
    `   ${f.explanation}`,
    `   ${f.reasoning}`,
  ].join("\n");
}

/**
 * The `predict` result card. When something can happen the cards are ranked
 * most-favourable-first, each with the number and the reason; when nothing
 * can, the rules' declines are printed so "no reaction" always says *why*
 * instead of being an empty list. Rule-bug skips (unbalanceable proposals)
 * are shown, not hidden, and merged duplicates are counted.
 */
export function renderPrediction(
  input: string,
  ranked: readonly Feasibility[],
  declined: readonly Declined[],
  duplicatesDropped: number,
  skips: readonly Candidate[],
): string {
  const lines: string[] = [`${paint("Predicting", "bold")} ${input}.`, ""];
  if (ranked.length === 0) {
    lines.push(paint("No reaction expected.", "bold"));
    for (const d of declined) lines.push(`  ${paint("•", "dim")} ${d.subject} — ${d.reason}`);
  } else {
    ranked.forEach((f, i) => lines.push(renderCandidateCard(i + 1, f)));
  }
  for (const skip of skips) {
    lines.push("");
    lines.push(`  ${paint(`[${skip.rule}] skip`, "yellow")} ${skip.proposed} — ${skip.skipReason}`);
  }
  if (duplicatesDropped > 0) {
    lines.push(`  (${duplicatesDropped} duplicate proposal${duplicatesDropped === 1 ? "" : "s"} merged)`);
  }
  return lines.join("\n");
}

/** The `feasibility` card: the priced equation and the verdict with its number. */
export function renderFeasibility(text: string, balanced: BalancedEquation, gibbs: ReactionGibbs): string {
  const header = `${paint("Feasibility", "bold")}: ${renderFriendlyBalanced(text, balanced)}`;
  return `${header}\n\n${explain(gibbs)}`;
}