/**
 * Combination (synthesis): two substances join into one, at least one of them a
 * compound.
 *
 * Element + element is a different question and lives in `simpleMaterials`
 * (`2Na + Cl2 -> 2NaCl`, `Fe + S -> FeS`); this table keeps the joins that
 * involve a compound — a carbon oxide burning on (`2CO + O2 -> 2CO2`), the
 * contact process (`2SO2 + O2 -> 2SO3`), the brown-gas test, slaking lime,
 * fixing lime back to limestone, and the white-smoke test. Splitting the two
 * keeps one home per question, so the engine's dedupe never fires between them.
 *
 * Like the simple-materials table, the reactions are **curated**, the same
 * stance ACID_ANIONS and DISPLACEMENT_CHARGE take: nothing in a formula tells
 * you that carbon monoxide burns on to CO2 but nitrogen monoxide needs a
 * different entry, so the known reactions are written down instead of derived.
 * Most entries price cleanly (`2CO + O2 -> 2CO2` reads −514.40 kJ/mol), and the
 * few the table cannot price — `NO + O2 -> 2NO2(g)`, because the table holds no
 * NO — are still proposed, with their ΔG honestly unknown.
 *
 * Every pair the table does not hold is told so plainly, so "no combination
 * known here" is never confused with "nothing reacts".
 */
import type { PhysicalState } from "../core/equation.ts";
import { tryGetElement } from "../core/elements.ts";
import { parseFormula } from "../core/formula.ts";
import { isSimpleSubstance } from "./elements.ts";
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
  // A compound burning on in oxygen.
  { kind: "product", reactants: [{ formula: "CO", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "CO2", state: "g" } },
  { kind: "product", reactants: [{ formula: "SO2", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "SO3", state: "g" }, note: "the contact process" },
  { kind: "product", reactants: [{ formula: "NO", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "NO2", state: "g" }, note: "the brown gas test" },
  // Compound + compound.
  { kind: "product", reactants: [{ formula: "CaO", state: "s" }, { formula: "H2O", state: "l" }], product: { formula: "Ca(OH)2", state: "s" }, note: "slaking lime" },
  { kind: "product", reactants: [{ formula: "CaO", state: "s" }, { formula: "CO2", state: "g" }], product: { formula: "CaCO3", state: "s" } },
  { kind: "product", reactants: [{ formula: "NH3", state: "g" }, { formula: "HCl", state: "g" }], product: { formula: "NH4Cl", state: "s" }, note: "the white smoke test" },
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
 * Two substances combine when their pair matches a curated entry. Refused rows
 * are as first-class as proposals, and every unmatched pair is told the table
 * has no entry for it — silence would read as judgement.
 */
export const combination: ReactionRule = {
  name: "combination",
  description:
    "a compound joins another substance into one, from a curated table of known combinations (2CO + O2 → 2CO2, CaO + H2O → Ca(OH)2, …)",
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
      // Element + element is simpleMaterials' question; leave it to that table
      // so the two never propose the same reaction.
      if (isSimpleSubstance(a) && isSimpleSubstance(b)) continue;
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
