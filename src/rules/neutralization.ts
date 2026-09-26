/**
 * Neutralisation: an acid and a base make a salt and water.
 *
 * **The acid's anion is a curated table, and has to be.** `HCl` and `CH3COOH`
 * are neutral molecules — the structure layer correctly refuses to call them
 * dissociated — so nothing in a formula says that sulphuric acid hands over two
 * protons and leaves SO₄²⁻ behind. That is chemistry, so it is written down
 * (`ACID_ANIONS`), keyed on the canonical formula, and the tests re-derive every
 * entry by subtracting hydrogens from the acid, so a typo cannot survive.
 *
 * **The base's cation is not curated** — it is read off the graph, because
 * `structure/` already builds NaOH as Na⁺ + OH⁻ and Ca(OH)₂ as Ca²⁺ + 2 OH⁻, and
 * re-writing that in a table would be a second source of truth to drift. The
 * cost is that ammonia, which has no hydroxide to give, is declined: it forms an
 * ammonium salt *directly* rather than a salt plus water, and writing
 * "NH₄OH" would be the fiction the plan refuses. A carbonate is a different
 * shape again (salt + water + CO₂, three products) and is declined with a
 * pointer, not silently ignored.
 *
 * **The salt's phase comes from `solubility.ts`**, the same table T6 wrote, so
 * neutralisation and double displacement cannot disagree about whether CaSO₄
 * comes out of solution. A salt the solubility rules cannot judge is written
 * `(aq)`: a neutralisation gives a dissolved salt unless the table says
 * otherwise, and that default is a stated limit rather than a claim.
 *
 * Both reactants and the salt are aqueous unless the user typed a phase, and
 * the water is liquid — which is what makes the strong-acid case come out at the
 * familiar −79.9 kJ/mol.
 */
import type { PhysicalState } from "../core/equation.ts";
import { buildSalt, ionFromFormula, splitIons, type Ion } from "./ions.ts";
import { saltPhase, solubilityOf } from "./solubility.ts";
import {
  formatEquation,
  parseSpeciesInput,
  type Declined,
  type PredictContext,
  type Proposal,
  type ReactionRule,
  type SpeciesInput,
} from "./types.ts";

/**
 * Acid to the anion it leaves behind, keyed on the canonical formula.
 *
 * Written as the ion formula a person would use, then read through the engine's
 * one charge reader. The acids whose salts the table can price are HCl, H₂SO₄,
 * HNO₃ and H₃PO₄; the rest are here because they are real chemistry, and a
 * prediction with no ΔGf° is a legitimate outcome to report rather than a reason
 * to leave the acid out.
 */
export const ACID_ANIONS: ReadonlyMap<string, string> = new Map([
  ["ClH", "Cl-"], // HCl
  ["BrH", "Br-"], // HBr
  ["HI", "I-"], // HI
  ["FH", "F-"], // HF
  ["H2O4S", "SO4^2-"], // H2SO4
  ["HNO3", "NO3-"], // HNO3
  ["HNO2", "NO2-"], // HNO2
  ["H3O4P", "PO4^3-"], // H3PO4
  ["CH2O3", "CO3^2-"], // H2CO3
  ["H2S", "S^2-"], // H2S
  ["C2H4O2", "CH3COO-"], // CH3COOH, ethanoic acid
  ["ClHO4", "ClO4-"], // HClO4
]);

/** Everything dissolves, unless the solubility table says it does not. */
const DISSOLVED: PhysicalState = "aq";
/** The product water is liquid at the temperature the table is quoted at. */
const WATER: PhysicalState = "l";

/** A carbonate anion, which makes three products and not two. */
const CARBONATE = "CO3";

/** Is this species something the acid side of the rule accepts? */
function isAcid(species: SpeciesInput): boolean {
  return species.classification.classes.includes("acid");
}

/** Is this species something the base side of the rule accepts? */
function isBase(species: SpeciesInput): boolean {
  return species.classification.classes.includes("base");
}

/**
 * The cation a base contributes, read off its structure.
 *
 * `undefined` for a base with no hydroxide to lose — ammonia and its relatives,
 * which make a salt directly instead of a salt plus water.
 */
function baseCation(base: SpeciesInput): Ion | undefined {
  const split = splitIons(base);
  if (split === undefined) return undefined;
  return split.cations[0];
}

/** The anion an acid leaves, from the curated table. */
function acidAnion(acid: SpeciesInput): Ion | undefined {
  const written = ACID_ANIONS.get(acid.formula);
  return written === undefined ? undefined : ionFromFormula(written);
}

/** The anion of a species, when it is a carbonate, which needs three products. */
function anionFormula(species: SpeciesInput): string | undefined {
  return splitIons(species)?.anions[0]?.formula;
}

/**
 * The phase to write for a species: what the user typed, else dissolved.
 *
 * A base given as a solid is a real thing — NaOH pellets in water — and the
 * table holds both phases, so the typed phase is what the engine prices.
 */
function phaseOf(species: SpeciesInput): PhysicalState {
  return species.state ?? DISSOLVED;
}

/**
 * The salt's phase, from the solubility rules.
 *
 * `insoluble` means it comes out of solution as a solid; anything else — soluble
 * or unjudged — is written dissolved.
 */
/** How a salt reads on a card, with the numbers behind the formula. */
function describeSalt(salt: string): string {
  const verdict = solubilityOf(parseSpeciesInput(salt));
  if (verdict === undefined) return "a salt";
  return verdict.solubility === "insoluble" ? `an insoluble salt (${salt})` : `a salt (${salt})`;
}

/**
 * Acid + base → salt + water.
 *
 * The gate opens on *either* half being present, so that `chem predict "HCl"`
 * gets to say the base is missing rather than the engine reporting that no rule
 * applies — the same reasoning the combustion rule uses for missing oxygen.
 */
export const neutralization: ReactionRule = {
  name: "neutralization",
  description: "an acid and a base make a salt and water",
  applies: (ctx: PredictContext) => ctx.species.some((s) => isAcid(s) || isBase(s)),
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];
    const acids = ctx.species.filter(isAcid);
    const bases = ctx.species.filter(isBase);

    // A carbonate with an acid is a different reaction, and the shape of it does
    // not fit "salt and water" — so it says where it went. Walk every species,
    // not just the bases, because a carbonate is a *salt* to the classifier: it
    // would never make it into `bases`, and "HCl Na2CO3" deserves the carboxyl
    // answer rather than a claim that no base is present.
    let carbonateDeclined = false;
    for (const species of ctx.species) {
      if (anionFormula(species) === CARBONATE && acids.length > 0) {
        declined.push({
          subject: species.input,
          reason: "a carbonate plus an acid gives a salt, water and CO2 — three products, which this rule does not write",
        });
        carbonateDeclined = true;
      }
    }

    if (acids.length === 0) {
      for (const base of bases) {
        declined.push({ subject: base.input, reason: "neutralisation needs an acid, and none was given" });
      }
      return { proposals, declined };
    }
    if (bases.length === 0) {
      // A carbonate decline already said what happens to the acid, so the
      // "needs a base" line would be a contradiction: the base is there, it
      // just does not neutralise in this rule's shape.
      if (!carbonateDeclined) {
        for (const acid of acids) {
          declined.push({ subject: acid.input, reason: "neutralisation needs a base, and none was given" });
        }
      }
      return { proposals, declined };
    }

    for (const acid of acids) {
      const anion = acidAnion(acid);
      if (anion === undefined) {
        declined.push({
          subject: acid.input,
          reason: `no anion is known for ${acid.input}, so the salt it would make cannot be written`,
        });
        continue;
      }
      for (const base of bases) {
        const cation = baseCation(base);
        if (cation === undefined) {
          declined.push({
            subject: base.input,
            reason: `${base.input} is a base with no hydroxide ion — it forms a salt directly with an acid rather than a salt and water, which this rule does not write`,
          });
          continue;
        }
        const salt = buildSalt(cation, anion);
        proposals.push({
          equation: formatEquation(
            [
              { formula: acid.input, state: phaseOf(acid) },
              { formula: base.input, state: phaseOf(base) },
            ],
            [
              { formula: salt, state: saltPhase(salt) },
              { formula: "H2O", state: WATER, coefficient: 2 },
            ],
          ),
          reasoning: `the acid gives up ${anion.formula} and the base gives up ${cation.formula}, so they make ${describeSalt(salt)} and water`,
        });
      }
    }

    return { proposals, declined: uniqueDeclines(declined) };
  },
};

/** Drop repeated declines: two acids and one ammonia would name ammonia twice. */
function uniqueDeclines(declined: Declined[]): Declined[] {
  const seen = new Set<string>();
  const out: Declined[] = [];
  for (const entry of declined) {
    const key = `${entry.subject}\u0000${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
