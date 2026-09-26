/**
 * Combustion: a fuel of carbon, hydrogen and oxygen burns completely in oxygen
 * to carbon dioxide and water.
 *
 * **What counts as a fuel is an element test, not a class label.** Any molecule
 * of C, H and O with at least one carbon *and* one hydrogen burns to CO2 and
 * H2O — that covers the classified hydrocarbons and alcohols and also the
 * compounds the classifier has no word for (glucose is an "alcohol" by M3's
 * reading, and burns to exactly the same products). The classes only decide
 * whether the rule has anything to say at all; they never decide the equation.
 *
 * **Anything else is declined out loud.** A chlorinated fuel would also have to
 * produce HCl, a nitrogenous one N2, and neither product is in the table, so
 * the rule says which element stopped it instead of quietly emitting an
 * equation that is missing a product. Carbon with no hydrogen is left to the
 * combination table (`C + O2 → CO2`), which is where a textbook puts it.
 *
 * **The water is liquid and that is a real choice.** Combustion at 298 K is
 * quoted with H2O(l) — the value the milestone is measured against — and the
 * vapour figure is 17.1 kJ/mol higher for every mole of water, so a rule that
 * did not fix the phase would hand the engine a 34 kJ/mol question mark on
 * methane alone. The phase of the *fuel* is not something this rule may guess:
 * it is taken from what the user typed, and otherwise from the phase the thermo
 * table already holds for that species. A fuel the table has never heard of gets
 * no phase, which surfaces as an unknown-ΔG candidate rather than a guess.
 */
import { parseFormula } from "../core/formula.ts";
import { tryGetElement } from "../core/elements.ts";
import type { PhysicalState } from "../core/equation.ts";
import { dGfOf, thermoEntry } from "../thermo/table.ts";
import {
  formatEquation,
  type Declined,
  type PredictContext,
  type Proposal,
  type ReactionRule,
  type SpeciesInput,
} from "./types.ts";

/** The elements a complete burn can account for: carbon dioxide, and water. */
const BURNABLE: ReadonlySet<string> = new Set(["C", "H", "O"]);

/** Where each product comes from, and the phase it is in at 298 K. */
const CARBON_DIOXIDE: PhysicalState = "g";
const WATER: PhysicalState = "l";
const OXYGEN: PhysicalState = "g";

/** The oxidiser, read off the formula rather than a name. */
function isOxygen(species: SpeciesInput): boolean {
  return species.formula === "O2";
}

/** Element symbols of a formula, or an empty list if it cannot be read. */
function elementsOf(formula: string): string[] {
  return [...parseFormula(formula).elements.keys()];
}

/**
 * The phase to write for a reactant.
 *
 * What the user typed wins; failing that, the phase the table already holds.
 * `undefined` means the rule has no basis for one, and the term is written
 * without a phase so the thermo lookup reports an unknown instead of a number.
 */
function phaseOf(species: SpeciesInput): PhysicalState | undefined {
  if (species.state !== undefined) return species.state;
  const lookup = dGfOf(species.formula);
  return lookup.known ? lookup.state : undefined;
}

/** How to name a species on the card: the table's name when it has one. */
function label(species: SpeciesInput): string {
  return thermoEntry(species.formula)?.name ?? species.formula;
}

/** How a blocked-out element reads in a sentence, e.g. "chlorine" for Cl. */
function elementName(symbol: string): string {
  const name = tryGetElement(symbol)?.name ?? symbol;
  // The elements table capitalises ("Chlorine"); mid-sentence it should not.
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * Could this species burn at all? Carbon and hydrogen, whatever else is in it —
 * the elements are checked when the equation is written, so a chlorinated fuel
 * still gets an answer here and gets told why it does not get an equation.
 */
function burnable(species: SpeciesInput): boolean {
  const elements = new Set(elementsOf(species.formula));
  return elements.has("C") && elements.has("H");
}

/** The compounds the classifier has a word for that this rule can burn. */
const FUEL_KIND: ReadonlyMap<string, string> = new Map([
  ["hydrocarbon", "a hydrocarbon"],
  ["alcohol", "an alcohol"],
  ["aldehyde", "an aldehyde"],
  ["ketone", "a ketone"],
  ["ester", "an ester"],
  ["ether", "an ether"],
  ["carboxylic-acid", "a carboxylic acid"],
  ["aromatic", "an aromatic hydrocarbon"],
]);

/** A description of the fuel for the reasoning line. */
function fuelKind(species: SpeciesInput): string {
  const primary = species.classification.primary;
  if (primary !== "unknown") {
    const kind = FUEL_KIND.get(primary);
    if (kind !== undefined) return kind;
  }
  for (const name of species.classification.classes) {
    const kind = FUEL_KIND.get(name);
    if (kind !== undefined) return kind;
  }
  return "a compound of carbon, hydrogen and oxygen";
}

/**
 * Complete combustion of a fuel.
 *
 * The equation is written without coefficients on purpose: the engine runs it
 * through the balancer, so `C6H6 + O2` comes back balanced whatever the fuel
 * was, and a rule can never be the reason a coefficient is wrong.
 */
export const combustion: ReactionRule = {
  name: "combustion",
  description: "a fuel of carbon, hydrogen and oxygen burns completely in O2 to CO2 and H2O(l)",
  applies: (ctx: PredictContext) => ctx.species.some((species) => burnable(species) && !isOxygen(species)),
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];
    const oxygen = ctx.species.find(isOxygen);

    for (const species of ctx.species) {
      if (isOxygen(species)) continue;
      const elements = new Set(elementsOf(species.formula));
      if (!elements.has("C")) continue; // Not fuel-shaped; another rule's business.
      const subject = species.input;
      if (!elements.has("H")) {
        declined.push({
          subject,
          reason: "carbon with no hydrogen is not a fuel — burning carbon itself is the combination rule's job (C + O2 -> CO2)",
        });
        continue;
      }
      const strays = [...elements].filter((symbol) => !BURNABLE.has(symbol));
      if (strays.length > 0) {
        const names = strays.map(elementName);
        declined.push({
          subject,
          reason: `${subject} contains ${list(names)}, so burning it would make ${list(names)} compounds as well, which this rule does not write`,
        });
        continue;
      }
      if (oxygen === undefined) {
        declined.push({
          subject,
          reason: "combustion needs O2, and no oxygen was given",
        });
        continue;
      }
      proposals.push({
        equation: formatEquation(
          [
            // The spelling the person typed, not the canonical one: C2H5OH is
            // how they wrote the fuel and how the card should show it back.
            { formula: species.input, state: phaseOf(species) },
            { formula: "O2", state: OXYGEN },
          ],
          [
            { formula: "CO2", state: CARBON_DIOXIDE },
            { formula: "H2O", state: WATER, coefficient: 2 },
          ],
        ),
        reasoning: `${label(species)} is ${fuelKind(species)}, and a complete burn in oxygen gives carbon dioxide and liquid water`,
      });
    }

    return { proposals, declined };
  },
};

/** "x", "x and y", "x, y and z" — for a list inside a sentence. */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
