/**
 * Decomposition: one species breaks apart into two.
 *
 * Like combination (T11's sibling), the reactions are a **curated table** —
 * the known decompositions, each with the conditions it needs written down:
 * heating, an electric current, or (for H₂O₂) just time. The star of the table
 * is the one T4 pinned for M4: CaCO₃ → CaO + CO₂ reads **+131.01** — positive,
 * so it needs a kiln, and the card says the number, the reason, and the heat.
 *
 * **The table is honest about what is not on it.** A single species that has no
 * entry gets told there is no decomposition in the curated table, instead of
 * the engine shrugging — CO₂ does not split when you heat it, and the decline
 * says exactly that much and no more.
 *
 * Decomposition only reads single-species inputs: `chem predict "CaCO3"` asks
 * whether one substance falls apart. When several species are named, the other
 * rules get to speak and this one stays quiet.
 */
import type { PhysicalState } from "../core/equation.ts";
import { parseSpeciesInput, uniqueDeclines, type Declined, type PredictContext, type Proposal, type ReactionRule, type SpeciesInput } from "./types.ts";
import { formatEquation } from "./types.ts";
import { parseFormula } from "../core/formula.ts";
import { tryGetElement } from "../core/elements.ts";

/** One species of a known decomposition, in the state that reaction uses. */
export interface DecompositionSpecies {
  formula: string;
  state: PhysicalState;
}

export interface DecompositionEntry {
  source: DecompositionSpecies;
  products: [DecompositionSpecies, DecompositionSpecies];
  /** The condition the reaction needs — part of the known fact, not a guess. */
  note: string;
}

/**
 * The known decompositions. The molten-metal notes say the priced state is the
 * solid the table holds, not the molten reality — the equation never lies
 * about which number it used.
 */
export const DECOMPOSITION_ROWS: readonly DecompositionEntry[] = [
  {
    source: { formula: "CaCO3", state: "s" },
    products: [{ formula: "CaO", state: "s" }, { formula: "CO2", state: "g" }],
    note: "strong heating, the way a kiln does it",
  },
  {
    source: { formula: "Ca(OH)2", state: "s" },
    products: [{ formula: "CaO", state: "s" }, { formula: "H2O", state: "g" }],
    note: "heating drives off steam",
  },
  {
    source: { formula: "H2O", state: "l" },
    products: [{ formula: "H2", state: "g" }, { formula: "O2", state: "g" }],
    note: "needs an electric current — electrolysis; without one, nothing happens",
  },
  {
    source: { formula: "H2O2", state: "l" },
    products: [{ formula: "H2O", state: "l" }, { formula: "O2", state: "g" }],
    note: "it does this on its own, slowly — light and a catalyst speed it up",
  },
  {
    source: { formula: "NaCl", state: "s" },
    products: [{ formula: "Na", state: "s" }, { formula: "Cl2", state: "g" }],
    note: "molten salt, electrolysed (the Downs cell); the solid-state price is used",
  },
  {
    source: { formula: "MgO", state: "s" },
    products: [{ formula: "Mg", state: "s" }, { formula: "O2", state: "g" }],
    note: "needs electrolysis of the molten oxide; the solid-state price is used",
  },
  {
    source: { formula: "NH4Cl", state: "s" },
    products: [{ formula: "NH3", state: "g" }, { formula: "HCl", state: "g" }],
    note: "heating, then the gases recombine as a white solid on any cold surface",
  },
];

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
 * Single-species question, answered by the table: decompose, or say plainly
 * that the curated table has no decomposition for it.
 */
export const decomposition: ReactionRule = {
  name: "decomposition",
  description:
    "one species breaks apart into two, from a curated table of known decompositions (CaCO3 → CaO + CO2, 2H2O → 2H2 + O2, …)",
  applies: (ctx: PredictContext) => ctx.species.length === 1,
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];
    const species = ctx.species[0]!;
    const bySource = new Map<string, DecompositionEntry>();
    for (const row of DECOMPOSITION_ROWS) {
      bySource.set(parseSpeciesInput(row.source.formula).formula, row);
    }

    const row = bySource.get(species.formula);
    if (row === undefined) {
      declined.push({
        subject: species.input,
        reason: `no decomposition in the curated table for ${species.input}`,
      });
      return { proposals, declined };
    }

    proposals.push({
      equation: formatEquation(
        [{ formula: species.input, state: species.state ?? row.source.state }],
        [
          { formula: row.products[0]!.formula, state: row.products[0]!.state },
          { formula: row.products[1]!.formula, state: row.products[1]!.state },
        ],
      ),
      reasoning: `${nameOf(species)} breaks apart into ${row.products[0]!.formula} and ${row.products[1]!.formula} (${row.note})`,
    });
    return { proposals, declined: uniqueDeclines(declined) };
  },
};