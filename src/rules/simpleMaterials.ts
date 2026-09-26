/**
 * Simple materials: element + element -> binary compound.
 *
 * The other rules are compound-shaped — acids, bases, salts, hydrocarbons.
 * This one answers the most ordinary question a person types first: what
 * happens when two simple substances meet? `Na + Cl` is the report that started
 * it — the curated table already held `Na + Cl2 -> NaCl`, but a bare `Cl` was
 * read as monatomic and never matched. `elements.ts` supplies the standard
 * elemental form (`Cl -> Cl2`), and this rule matches on it.
 *
 * Like combination, the reactions are a **curated table**, not generated
 * chemistry: a formula cannot tell you that magnesium and oxygen land on MgO
 * while nitrogen and oxygen must not be written (forming NO is endothermic and
 * takes lightning-scale energy). The table also knows its noes, and every pair
 * it does not hold is told so plainly — "no entry" is never silence.
 *
 * The gate is element + element: at least one simple substance is named, and
 * this rule considers only pairs where **both** species are simple substances.
 * Pairs that involve a compound are left to combination, so the two tables
 * never propose the same reaction and the engine's dedupe stays quiet.
 */
import type { PhysicalState } from "../core/equation.ts";
import { tryGetElement } from "../core/elements.ts";
import { parseFormula } from "../core/formula.ts";
import { elementalForm, isSimpleSubstance } from "./elements.ts";
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

/** One reactant of a known simple-material reaction, in the state it uses. */
export interface SimpleMaterialReactant {
  formula: string;
  state: PhysicalState;
}

export type SimpleMaterialRow =
  | {
      kind: "product";
      reactants: [SimpleMaterialReactant, SimpleMaterialReactant];
      product: { formula: string; state: PhysicalState };
      note?: string;
    }
  | { kind: "refused"; reactants: [string, string]; reason: string };

/**
 * The known element + element reactions. Formulas are written the way a
 * textbook would; they are canonicalised once at load so a species matches
 * whatever order it was typed in.
 */
export const SIMPLE_MATERIAL_ROWS: readonly SimpleMaterialRow[] = [
  // Metal + halogen -> the halide salt.
  { kind: "product", reactants: [{ formula: "Na", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "NaCl", state: "s" }, note: "sodium burns in chlorine" },
  { kind: "product", reactants: [{ formula: "K", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "KCl", state: "s" } },
  { kind: "product", reactants: [{ formula: "Ca", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "CaCl2", state: "s" } },
  { kind: "product", reactants: [{ formula: "Mg", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "MgCl2", state: "s" } },
  { kind: "product", reactants: [{ formula: "Al", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "AlCl3", state: "s" } },
  { kind: "product", reactants: [{ formula: "Zn", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "ZnCl2", state: "s" } },
  { kind: "product", reactants: [{ formula: "Cu", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "CuCl2", state: "s" } },
  { kind: "product", reactants: [{ formula: "Fe", state: "s" }, { formula: "Cl2", state: "g" }], product: { formula: "FeCl3", state: "s" }, note: "chlorine takes iron to iron(III)" },
  { kind: "product", reactants: [{ formula: "Na", state: "s" }, { formula: "Br2", state: "l" }], product: { formula: "NaBr", state: "s" } },
  { kind: "product", reactants: [{ formula: "K", state: "s" }, { formula: "Br2", state: "l" }], product: { formula: "KBr", state: "s" } },
  { kind: "product", reactants: [{ formula: "H2", state: "g" }, { formula: "Cl2", state: "g" }], product: { formula: "HCl", state: "g" }, note: "hydrogen burns in chlorine" },
  // Metal + oxygen -> the oxide.
  { kind: "product", reactants: [{ formula: "Mg", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "MgO", state: "s" }, note: "burns with a brilliant white flame" },
  { kind: "product", reactants: [{ formula: "Ca", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "CaO", state: "s" } },
  { kind: "product", reactants: [{ formula: "Cu", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "CuO", state: "s" } },
  { kind: "product", reactants: [{ formula: "Al", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "Al2O3", state: "s" } },
  { kind: "product", reactants: [{ formula: "Zn", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "ZnO", state: "s" } },
  // Metal + sulfur -> the sulfide.
  { kind: "product", reactants: [{ formula: "Fe", state: "s" }, { formula: "S", state: "s" }], product: { formula: "FeS", state: "s" } },
  { kind: "product", reactants: [{ formula: "Zn", state: "s" }, { formula: "S", state: "s" }], product: { formula: "ZnS", state: "s" } },
  // Non-metal + non-metal -> the molecular compound.
  { kind: "product", reactants: [{ formula: "H2", state: "g" }, { formula: "O2", state: "g" }], product: { formula: "H2O", state: "l" } },
  { kind: "product", reactants: [{ formula: "N2", state: "g" }, { formula: "H2", state: "g" }], product: { formula: "NH3", state: "g" }, note: "the Haber process" },
  { kind: "product", reactants: [{ formula: "C", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "CO2", state: "g" } },
  { kind: "product", reactants: [{ formula: "S", state: "s" }, { formula: "O2", state: "g" }], product: { formula: "SO2", state: "g" } },
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
  {
    kind: "refused",
    reactants: ["Na", "O2"],
    reason: "sodium does not burn to the simple oxide — it forms the peroxide (Na2O2), and this table does not write that reaction",
  },
  {
    kind: "refused",
    reactants: ["K", "O2"],
    reason: "potassium does not burn to the simple oxide — it forms the superoxide (KO2), and this table does not write that reaction",
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
 * Two simple substances react when their pair matches a curated entry. Refused
 * rows are as first-class as proposals, and every unmatched pair is told the
 * table has no entry for it — silence would read as judgement.
 */
export const simpleMaterials: ReactionRule = {
  name: "simpleMaterials",
  description:
    "two simple substances (elements) join into a binary compound, from a curated table (2Na + Cl2 → 2NaCl, Fe + S → FeS, …)",
  applies: (ctx: PredictContext) => ctx.species.length >= 2 && ctx.species.some(isSimpleSubstance),
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];
    const byPair = new Map<string, SimpleMaterialRow>();
    for (const row of SIMPLE_MATERIAL_ROWS) {
      const [first, second] = row.kind === "product" ? row.reactants.map((r) => r.formula) : row.reactants;
      byPair.set(pairKey(first!, second!), row);
    }

    for (const [a, b] of speciesPairs(ctx)) {
      // Compound-involving pairs belong to combination; this rule only speaks
      // for element + element.
      if (!isSimpleSubstance(a) || !isSimpleSubstance(b)) continue;
      const formA = elementalForm(a);
      const formB = elementalForm(b);
      const row = byPair.get(pairKey(formA.formula, formB.formula));
      if (row === undefined) {
        declined.push({
          subject: `${a.input} ${b.input}`,
          reason: `the curated simple-materials table has no entry for ${a.input} + ${b.input}`,
        });
        continue;
      }
      if (row.kind === "refused") {
        declined.push({ subject: `${a.input} ${b.input}`, reason: row.reason });
        continue;
      }
      const stateFor = (species: SpeciesInput, form: { formula: string; state?: PhysicalState }): PhysicalState | undefined => {
        const entry = row.reactants.find((r) => canonicalize(r.formula) === canonicalize(form.formula));
        return form.state ?? entry?.state;
      };
      const note = row.note === undefined ? "" : ` (${row.note})`;
      proposals.push({
        equation: formatEquation(
          [
            { formula: formA.formula, state: stateFor(a, formA) },
            { formula: formB.formula, state: stateFor(b, formB) },
          ],
          [{ formula: row.product.formula, state: row.product.state }],
        ),
        reasoning: `${nameOf(a)} and ${nameOf(b)} combine into a single substance — ${row.product.formula}${note}`,
      });
    }

    return { proposals, declined: uniqueDeclines(declined) };
  },
};
