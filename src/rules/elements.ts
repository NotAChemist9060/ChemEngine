/**
 * The standard elemental substances — the "simple materials" a person names
 * with a bare element symbol.
 *
 * `Cl` is how a chemist writes chlorine on a reagent bottle, but the substance
 * that actually reacts is `Cl2`, the standard reference state. The thermo table
 * already encodes that — H2(g), O2(g), N2(g), Cl2(g) and Br2(l) are all 0 by
 * definition — and the curated combination/simple-materials rows are written
 * with those forms. Without this mapping a typed `Na + Cl` would never match
 * the `Na + Cl2 -> NaCl` row, and the engine would answer "no reaction" for one
 * of the most ordinary reactions there is.
 *
 * This is a **definition**, not a guess: the seven elements that are diatomic
 * at 298 K are exactly H, N, O, F, Cl, Br and I. Everything else — the metals,
 * carbon, sulfur, phosphorus — is named the way the table already holds it
 * (`C(s)`, `S(s)`, `P(s)`), so it passes through untouched. The mapping is
 * applied by the rules layer, never to `parseSpeciesInput` itself, so
 * `classify` and balancing keep seeing exactly what the user typed.
 */
import type { PhysicalState } from "../core/equation.ts";
import { parseFormula } from "../core/formula.ts";
import type { SpeciesInput } from "./types.ts";

/** The diatomic elements, bare symbol -> standard elemental formula. */
const DIATOMIC: Readonly<Record<string, string>> = {
  H: "H2",
  N: "N2",
  O: "O2",
  F: "F2",
  Cl: "Cl2",
  Br: "Br2",
  I: "I2",
};

/** A species written in its standard elemental form, phase preserved. */
export interface ElementalForm {
  /** Standard elemental formula, e.g. "Cl2". */
  formula: string;
  /** The phase the user typed, when they typed one. */
  state?: PhysicalState;
}

/** True when the species is a simple substance: one element and nothing else. */
export function isSimpleSubstance(species: SpeciesInput): boolean {
  return species.classification.classes.includes("element");
}

/** The lone element of a one-element formula, with its atom count. */
function onlyElement(species: SpeciesInput): { symbol: string; count: number } | undefined {
  const { elements } = parseFormula(species.formula);
  if (elements.size !== 1) return undefined;
  const [symbol, count] = [...elements.entries()][0]!;
  return { symbol, count };
}

/**
 * The standard elemental substance for a bare element: `Cl` -> `Cl2`,
 * `O` -> `O2`, `H` -> `H2`. An element already written in a multi-atom form
 * (`Cl2`, `O2`), a metal (`Na`), or a compound passes through unchanged, and a
 * phase the user typed is always kept.
 */
export function elementalForm(species: SpeciesInput): ElementalForm {
  const only = onlyElement(species);
  const mapped = only !== undefined && only.count === 1 ? DIATOMIC[only.symbol] : undefined;
  const formula = mapped ?? species.formula;
  return species.state === undefined ? { formula } : { formula, state: species.state };
}
