/**
 * Redox: reduction and oxidation between two substances.
 *
 * The report that started it: `predict "CuO H2"` answered *No reaction
 * expected* — copper(II) oxide reduced by hydrogen to copper is one of the
 * oldest reactions there is, and no rule spoke for it. `simpleMaterials` needs
 * both species to be elements, `combination` has no reduction row, and nothing
 * else looks at the electron bookkeeping.
 *
 * Three patterns, all read off the graph rather than matched as strings:
 *
 *  - **Metal-oxide reduction.** `CuO + H2 -> Cu + H2O`, `Fe2O3 + 3CO -> 2Fe +
 *    3CO2`, `CuO + C -> Cu + CO`. The metal comes off the oxide's own ion split
 *    (Cu²⁺ + O²⁻), the reducing agent is one of the three the rule writes
 *    (H₂, C, CO), and the engine balances what the rule proposes. The very
 *    active oxides — the Group 1/2 and aluminium ones — are declined: they are
 *    not reduced by these agents, the metal needs electrolysis, and saying so
 *    is more useful than a confident positive-ΔG card.
 *
 *  - **Halogen displacement.** `Cl2 + 2NaBr -> 2NaCl + Br2`, when the free
 *    halogen sits above the one in the salt in the order F > Cl > Br > I. The
 *    metal halide is read off its graph (metal cation + halide anion) and the
 *    new salt is built by charge balance, the same way `doubleDisplacement`
 *    builds one. The reverse — iodine trying to displace chlorine — is declined
 *    with the order that says why.
 *
 *  - **Metal + steam.** `3Fe + 4H2O -> Fe3O4 + 4H2`. Which oxide a metal forms
 *    is **curated**, because a formula cannot say that iron gives magnetite and
 *    not Fe₂O₃; the metals cold water already handles (K/Na/Li/Ca) are left to
 *    `singleDisplacement`.
 *
 * Every decline carries its sentence. A pair the rule has nothing to say about
 * is left silent rather than declined, so the other rules' cards stay readable.
 */
import type { PhysicalState } from "../core/equation.ts";
import { parseFormula } from "../core/formula.ts";
import { tryGetElement } from "../core/elements.ts";
import { isHalogen, isMetal } from "../structure/valence.ts";
import { dGfOf } from "../thermo/table.ts";
import { elementalForm, isSimpleSubstance } from "./elements.ts";
import { buildSalt, ionFromFormula, splitIons, type Ion } from "./ions.ts";
import { saltPhase, solubilityOf } from "./solubility.ts";
import { displacesHydrogen, seriesMetal } from "./series.ts";
import {
  formatEquation,
  parseSpeciesInput,
  uniqueDeclines,
  type Declined,
  type PredictContext,
  type Proposal,
  type ReactionRule,
  type SpeciesInput,
} from "./types.ts";
/** The reducing agents this rule writes, and what each becomes. */
interface Agent {
  formula: string;
  state: PhysicalState;
  product: { formula: string; state: PhysicalState };
  /** How it reads on the card. */
  word: string;
}

const AGENTS: readonly Agent[] = [
  { formula: "H2", state: "g", product: { formula: "H2O", state: "l" }, word: "hydrogen" },
  { formula: "C", state: "s", product: { formula: "CO", state: "g" }, word: "carbon" },
  { formula: "CO", state: "g", product: { formula: "CO2", state: "g" }, word: "carbon monoxide" },
];

/** The halogen order; a free halogen above another displaces it. */
const HALOGEN_ORDER: readonly string[] = ["F", "Cl", "Br", "I"];

/**
 * Oxides whose metal will not come out with hydrogen, carbon or carbon
 * monoxide: the Group 1 and Group 2 metals and aluminium. Reducing them is an
 * electrolysis job, and the rule says so instead of pricing a route nobody runs.
 */
const ELECTROLYSIS_ONLY: ReadonlySet<string> = new Set([
  "K", "Na", "Li", "Ca", "Mg", "Al", "Ba", "Sr",
]);

/** Cold-water metals other rules own, so steam does not double up on them. */
const COLD_WATER: ReadonlySet<string> = new Set(["K", "Na", "Li", "Ca"]);

/**
 * The oxide a metal forms with steam. Curated, because the product is measured
 * chemistry - iron gives magnetite (Fe3O4) with steam, not the Fe2O3 it gives
 * in air, and no formula says which.
 */
const STEAM_OXIDE: ReadonlyMap<string, { formula: string; state: PhysicalState }> = new Map([
  ["Mg", { formula: "MgO", state: "s" }],
  ["Al", { formula: "Al2O3", state: "s" }],
  ["Zn", { formula: "ZnO", state: "s" }],
  ["Fe", { formula: "Fe3O4", state: "s" }],
  ["Sn", { formula: "SnO2", state: "s" }],
  ["Pb", { formula: "PbO", state: "s" }],
  ["Ni", { formula: "NiO", state: "s" }],
  ["Co", { formula: "CoO", state: "s" }],
]);

/** The standard (physical) state of a substance, from the table, else solid. */
function standardState(formula: string): PhysicalState {
  const found = dGfOf(formula);
  return found.known ? found.state : "s";
}

/** The one element of a one-element formula, or undefined. */
function singleSymbol(species: SpeciesInput): string | undefined {
  const { elements } = parseFormula(species.formula);
  if (elements.size !== 1) return undefined;
  return [...elements.keys()][0];
}

/** A human word for a bare element; else the formula as written. */
function nameOf(species: SpeciesInput): string {
  const symbol = singleSymbol(species);
  if (symbol !== undefined) {
    const element = tryGetElement(symbol);
    if (element !== undefined) return element.name.toLowerCase();
  }
  return species.input;
}

/**
 * The metal of an oxide: one distinct cation element and nothing but oxide
 * anions. undefined for CuSO4 or a mixed oxide, so only real metal oxides
 * reach the rule.
 */
function oxideMetal(species: SpeciesInput): string | undefined {
  if (!species.classification.classes.includes("oxide")) return undefined;
  const split = splitIons(species);
  if (split === undefined || split.neutrals.length > 0) return undefined;
  const symbols = new Set<string>();
  for (const cation of split.cations) {
    const keys = [...cation.counts.keys()];
    if (keys.length !== 1) return undefined;
    symbols.add(keys[0]!);
  }
  if (symbols.size !== 1) return undefined;
  for (const anion of split.anions) {
    if (anion.formula !== "O" || anion.charge !== -2) return undefined;
  }
  return [...symbols][0];
}

/** The metal of a bare metal species, e.g. Fe. */
function metalOf(species: SpeciesInput): string | undefined {
  const symbol = singleSymbol(species);
  if (symbol === undefined || !isMetal(symbol)) return undefined;
  return seriesMetal(species) ?? symbol;
}

/** The halogen a simple substance is, e.g. Cl/Cl2 -> "Cl". */
function halogenOf(species: SpeciesInput): string | undefined {
  if (!isSimpleSubstance(species)) return undefined;
  const symbol = singleSymbol(species);
  return symbol !== undefined && isHalogen(symbol) ? symbol : undefined;
}

/** One distinct metal cation and one halide anion. */
interface MetalHalide {
  cation: Ion;
  metal: string;
  halogen: string;
}

function metalHalide(species: SpeciesInput): MetalHalide | undefined {
  const split = splitIons(species);
  if (split === undefined || split.neutrals.length > 0 || split.anions.length === 0) return undefined;
  let halogen: string | undefined;
  for (const anion of split.anions) {
    if (anion.charge !== -1) return undefined;
    const keys = [...anion.counts.keys()];
    if (keys.length !== 1 || !isHalogen(keys[0]!)) return undefined;
    if (halogen !== undefined && halogen !== keys[0]!) return undefined;
    halogen = keys[0]!;
  }
  if (halogen === undefined) return undefined;
  const cations = new Map<string, Ion>();
  for (const cation of split.cations) {
    const keys = [...cation.counts.keys()];
    if (keys.length !== 1) return undefined;
    cations.set(keys[0]!, cation);
  }
  if (cations.size !== 1) return undefined;
  const [metal, cation] = [...cations.entries()][0]!;
  return { cation, metal, halogen };
}

/** The index of a halogen in the displacement order, or undefined. */
function halogenRank(element: string): number | undefined {
  const index = HALOGEN_ORDER.indexOf(element);
  return index === -1 ? undefined : index;
}

/** The elemental form of a bare halogen symbol, e.g. "Br" -> Br2. */
function halogenElemental(symbol: string): string {
  return elementalForm(parseSpeciesInput(symbol)).formula;
}

/**
 * Redox: metal-oxide reduction, halogen displacement, and metal + steam.
 */
export const redox: ReactionRule = {
  name: "redox",
  description:
    "reduction and oxidation - a metal oxide reduced by H2/C/CO, a halogen displacing a halide, or a metal oxidised by steam",
  applies: (ctx: PredictContext) => ctx.species.length >= 2,
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];

    // Metal-oxide reduction.
    for (const species of ctx.species) {
      const metal = oxideMetal(species);
      if (metal === undefined) continue;
      for (const agent of AGENTS) {
        const given = ctx.species.find(
          (s) =>
            s !== species &&
            s.formula === agent.formula &&
            (s.state === undefined || s.state === agent.state),
        );
        if (given === undefined) continue;
        if (ELECTROLYSIS_ONLY.has(metal)) {
          declined.push({
            subject: `${species.input} ${given.input}`,
            reason: `${metal} is too reactive to be reduced by ${agent.word} - its oxide needs electrolysis, not a chemical reducing agent`,
          });
          continue;
        }
        const element = tryGetElement(metal);
        const metalWord = element?.name.toLowerCase() ?? metal;
        proposals.push({
          equation: formatEquation(
            [
              { formula: species.input, state: species.state ?? "s" },
              { formula: agent.formula, state: agent.state },
            ],
            [
              { formula: metal, state: standardState(metal) },
              { formula: agent.product.formula, state: agent.product.state },
            ],
          ),
          reasoning: `${species.input} is reduced by ${agent.word} - ${metalWord} is freed and the ${agent.word} becomes ${agent.product.formula}`,
        });
      }
    }

    // Halogen displacement.
    for (const species of ctx.species) {
      const free = halogenOf(species);
      if (free === undefined) continue;
      for (const other of ctx.species) {
        if (other === species) continue;
        const halide = metalHalide(other);
        if (halide === undefined) continue;
        const freeRank = halogenRank(free);
        const boundRank = halogenRank(halide.halogen);
        if (freeRank === undefined || boundRank === undefined) continue;

        if (free === "F") {
          declined.push({
            subject: `${species.input} ${other.input}`,
            reason: "fluorine is so reactive it attacks the water itself, so this rule does not write its displacement",
          });
          continue;
        }
        if (freeRank > boundRank) {
          declined.push({
            subject: `${species.input} ${other.input}`,
            reason: `${free} sits below ${halide.halogen} in the halogen order F > Cl > Br > I, so it cannot displace it`,
          });
          continue;
        }
        const solubility = solubilityOf(other);
        if (solubility !== undefined && solubility.solubility === "insoluble") {
          declined.push({
            subject: `${species.input} ${other.input}`,
            reason: `${other.input} is not in solution, so there is no free ${halide.halogen} ion for ${free} to displace`,
          });
          continue;
        }
        const freeElemental = halogenElemental(free);
        const productHalide = buildSalt(halide.cation, ionFromFormula(`${free}-`)!);
        const freed = halogenElemental(halide.halogen);
        proposals.push({
          equation: formatEquation(
            [
              { formula: freeElemental, state: standardState(freeElemental) },
              { formula: other.input, state: other.state ?? "aq" },
            ],
            [
              { formula: productHalide, state: saltPhase(productHalide) },
              { formula: freed, state: standardState(freed) },
            ],
          ),
          reasoning: `${free} is above ${halide.halogen} in the halogen order, so it displaces ${halide.halogen} from ${other.input} - the products are ${productHalide} and ${freed}`,
        });
      }
    }

    // Metal + steam.
    const water = ctx.species.find((s) => s.formula === "H2O");
    if (water !== undefined) {
      for (const species of ctx.species) {
        const metal = metalOf(species);
        if (metal === undefined || COLD_WATER.has(metal)) continue;
        const oxide = STEAM_OXIDE.get(metal);
        if (oxide === undefined) continue;
        const verdict = displacesHydrogen(metal);
        if (verdict === undefined || !verdict.displaces) continue;
        proposals.push({
          equation: formatEquation(
            [
              { formula: species.input, state: species.state ?? standardState(metal) },
              { formula: "H2O", state: "g" },
            ],
            [
              { formula: oxide.formula, state: oxide.state },
              { formula: "H2", state: "g" },
            ],
          ),
          reasoning: `${metal} is above hydrogen, so red-hot ${nameOf(species)} reacts with steam - the products are ${oxide.formula} and H2`,
        });
      }
    }

    return { proposals, declined: uniqueDeclines(declined) };
  },
};
