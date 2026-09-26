/**
 * Combination (synthesis): two species join into one.
 *
 * The reactions are a **curated table**, the same stance ACID_ANIONS and
 * DISPLACEMENT_CHARGE take: nothing in the elements tells you that magnesium
 * and oxygen land on MgO but nitrogen and oxygen must not be written, so the
 * known reactions are written down instead of derived. Most entries price
 * cleanly (Mg + O₂ → 2MgO reads −1138.6 kJ/mol), and the few the table cannot
 * price — H₂ + Cl₂ → 2HCl(g), because the table holds only HCl(aq) — are still
 * proposed, with their ΔG honestly unknown.
 *
 * **The table also knows its noes.** N₂ + O₂ is the plan's negative: forming NO
 * is endothermic and needs lightning-scale energy, so there is no such entry
 * and the card says so. Iron gets the same treatment for a different reason —
 * Fe₂O₃ and Fe₃O₄ are both real, and the table does not guess between them.
 * Every other pair gets told plainly that this *curated* table has no entry for
 * it, so "no combination known here" is never confused with "nothing reacts".
 */
import type { PhysicalState } from "../core/equation.ts";
import { tryGetElement } from "../core/elements.ts";
import { parseFormula } from "../core/formula.ts";
import {
  formatEquation,
  parseSpeciesInput,
  speciesPairs,
  uniqueDeclines,
  type Declined,
  type PredictContext,
  type Proposal,
  type ReactionRule,
  type SpeciesInput,
} from "./types.ts";

/** One reactant of a known combination, in the state that reaction uses. */
export interface CombinationReactant {
  formula: string;
  state: PhysicalState;
}

export type CombinationRow =
  | {
      kind: "product";
      reactants: [CombinationReactant, CombinationReactant];
      product: { formula: string; state: PhysicalState };
      note?: string;
    }
  | { kind: "refused"; reactants: [string, string]; reason: string };

/**
 * The known combinations. Formulas are written the way a textbook would; they
 * are canonicalised once at load so a species the user names matches whether
 * its formula is "NH3" or the Hill-order "H3N".
 */
export const COMBINATION_ROWS: readonly CombinationRow[] = [
  // Elements + oxygen → the oxide.
  { kind: "product", reactants: [{ formula: "Mg", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "MgO", state: "s" }, note: "burns with a brilliant white flame" },
  { kind: "product", reactants: [{ formula: "Ca", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "CaO", state: "s" } },
  { kind: "product", reactants: [{ formula: "Cu", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "CuO", state: "s" } },
  { kind: "product", reactants: [{ formula: "Al", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "Al2O3", state: "s" } },
  { kind: "product", reactants: [{ formula: "C", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "CO2", state: "g" } },
  { kind: "product", reactants: [{ formula: "S", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "SO2", state: "g" } },
  // Non-metals with oxygen or hydrogen.
  { kind: "product", reactants: [{ formula: "H2", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "H2O", state: "l" } },
  { kind: "product", reactants: [{ formula: "N2", state: "g" }, { formula: "H2", state: "g" }], product: { formula: "NH3", state: "g" }, note: "the Haber process" },
  { kind: "product", reactants: [{ formula: "H2", state: "g" }, { formula: "Cl2", state: "g" }], product: { formula: "HCl", state: "g" } },
  { kind: "product", reactants: [{ formula: "Na", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "NaCl", state: "s" } },
  // A compound burning on in oxygen.
  { kind: "product", reactants: [{ formula: "CO", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "CO2", state: "g" } },
  { kind: "product", reactants: [{ formula: "SO2", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "SO3", state: "g" }, note: "the contact process" },
  { kind: "product", reactants: [{ formula: "NO", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "NO2", state: "g" }, note: "the brown gas test" },
  // Compound + compound.
  { kind: "product", reactants: [{ formula: "CaO", state: "s" }, { formula: "H2O", state: "l" }], product: { formula: "Ca(OH)2", state: "s" }, note: "slaking lime" },
  { kind: "product", reactants: [{ formula: "CaO", state: "s" }, { formula: "CO2", state: "g" }], product: { formula: "CaCO3", state: "s" } },
  { kind: "product", reactants: [{ formula: "NH3", state: "g" }, { formula: "HCl", state: "g" }], product: { formula: "NH4Cl", state: "s" }, note: "the white smoke test" },
  // The noes the table is asked about and declines, with the reason.
  {
    kind: "refused",
    reactants: ["N2", "O2"],
    reason: "nitrogen and oxygen do not combine in this table — forming NO is endothermic and takes lightning-scale energy, so the entry is deliberately omitted",
  },
  {
    kind: "refused",
    reactants: ["Fe", "O2"],
    reason: "iron has two common oxides (Fe2O3 and Fe3O4), and this table does not guess between them",
  },
];

/** The canonical spelling of a formula, exactly as a parsed species carries it. */
function canonicalize(friendly: string): string {
  return parseSpeciesInput(friendly).formula;
}

/** The canonical key of an unordered pair, order-safe. */
function pairKey(a: string, b: string): string {
  return [canonicalize(a), canonicalize(b)].sort().join("|");
}

/** A human word for a single element, else the formula as written. */
function nameOf(species: SpeciesInput): string {
  const { elements } = parseFormula(species.formula);
  if (elements.size === 1) {
    const symbol = [...elements.keys()][0]!;
    const element = tryGetElement(symbol);
    if (element !== undefined) return element.name.toLowerCase();
  }
  return species.input;
}

/**
 * Two species combine when their pair matches a curated entry. Refused rows are
 * as first-class as proposals, and every unmatched pair is told the table has
 * no entry for it — silence would read as judgement.
 */
export const combination: ReactionRule = {
  name: "combination",
  description:
    "two species join into one, from a curated table of known combinations (Mg + O2 → 2MgO, N2 + 3H2 → 2NH3, …)",
  applies: (ctx: PredictContext) => ctx.species.length >= 2,
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];
    const byPair = new Map<string, CombinationRow>();
    for (const row of COMBINATION_ROWS) {
      const [first, second] = row.kind === "product" ? row.reactants.map((r) => r.formula) : row.reactants;
      byPair.set(pairKey(first!, second!), row);
    }

    for (const [a, b] of speciesPairs(ctx)) {
      const row = byPair.get(pairKey(a.formula, b.formula));
      if (row === undefined) {
        declined.push({
          subject: `${a.input} ${b.input}`,
          reason: `the curated combination table has no entry for ${a.input} + ${b.input}`,
        });
        continue;
      }
      if (row.kind === "refused") {
        declined.push({ subject: `${a.input} ${b.input}`, reason: row.reason });
        continue;
      }
      const stateFor = (species: SpeciesInput): PhysicalState | undefined => {
        const entry = row.reactants.find((r) => canonicalize(r.formula) === species.formula);
        return species.state ?? entry?.state;
      };
      const note = row.note === undefined ? "" : ` (${row.note})`;
      proposals.push({
        equation: formatEquation(
          [
            { formula: a.input, state: stateFor(a) },
            { formula: b.input, state: stateFor(b) },
          ],
          [{ formula: row.product.formula, state: row.product.state }],
        ),
        reasoning: `${nameOf(a)} and ${nameOf(b)} combine into a single substance — ${row.product.formula}${note}`,
      });
    }

    return { proposals, declined: uniqueDeclines(declined) };
  },
};