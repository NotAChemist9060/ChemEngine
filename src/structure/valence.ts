/**
 * Bonding capacity and element-family predicates — the chemistry knowledge the
 * structure builder and the classifier share.
 *
 * Two ideas are kept apart on purpose:
 *  - **valence** (covalent): how many bonds an atom forms. Curated per element
 *    where the group rule is wrong or ambiguous (S can be 2, 4 or 6; N 3 or 5),
 *    otherwise derived from the IUPAC group.
 *  - **ionic charge** (`commonCharges`): what charge an atom carries in a salt.
 *
 * Everything degrades to "unknown" rather than guessing: an element with no
 * valence entry and no group returns 0, which callers must surface.
 */
import { groupOf, tryGetElement } from "../core/elements.ts";

export type Block = "s" | "p" | "d" | "f";

/**
 * Preferred covalent valence — the number of bonds a builder should try to
 * form first. Curated entries win; otherwise the main-group rule applies.
 */
const PREFERRED_VALENCE: Readonly<Record<string, number>> = {
  H: 1, B: 3, C: 4, N: 3, O: 2, F: 1,
  Si: 4, P: 3, S: 2, Cl: 1, Ge: 4, As: 3, Se: 2, Br: 1,
  Sn: 4, Sb: 3, Te: 2, I: 1, Pb: 4, Bi: 3, Po: 2, At: 1,
  Ti: 4, V: 5, Cr: 3, Mn: 4, Fe: 2, Co: 2, Ni: 2, Cu: 2, Zn: 2,
  Zr: 4, Nb: 5, Mo: 6, Tc: 7, Ru: 3, Rh: 3, Pd: 2, Ag: 1, Cd: 2,
  Hf: 4, Ta: 5, W: 6, Re: 6, Os: 4, Ir: 3, Pt: 2, Au: 1, Hg: 2,
  // lanthanides/actinides: treated as +3 (lanthanides) / variable (actinides)
  La: 3, Ce: 3, Nd: 3, Sm: 3, Eu: 3, Gd: 3, Dy: 3, Er: 3, Yb: 3, Lu: 3,
  Th: 4, U: 3, Pu: 4, Am: 3, Cm: 3,
};

/** Every valence state seen for the element, ascending. Used for matching, not building. */
const VALENCE_STATES: Readonly<Record<string, readonly number[]>> = {
  H: [1], B: [3], C: [4], N: [3, 5], O: [2], F: [1],
  Si: [4], P: [3, 5], S: [2, 4, 6], Cl: [1, 3, 5, 7],
  Ge: [4], As: [3, 5], Se: [2, 4, 6], Br: [1, 3, 5, 7],
  Sn: [2, 4], Sb: [3, 5], Te: [2, 4, 6], I: [1, 3, 5, 7],
  Pb: [2, 4], Bi: [3, 5], Po: [2, 4, 6], At: [1, 3, 5, 7],
};

/** Common monatomic/polyatomic-forming ionic charges, ascending. */
const CHARGES: Readonly<Record<string, readonly number[]>> = {
  H: [1, -1], Li: [1], Na: [1], K: [1], Rb: [1], Cs: [1], Fr: [1],
  Be: [2], Mg: [2], Ca: [2], Sr: [2], Ba: [2], Ra: [2],
  Al: [3], Ga: [3], In: [3], Tl: [1, 3], Zn: [2], Cd: [2],
  Fe: [2, 3], Cu: [1, 2], Ag: [1], Au: [1, 3], Ni: [2, 3], Co: [2, 3],
  Cr: [2, 3, 6], Mn: [2, 4, 7], Pb: [2, 4], Sn: [2, 4], Hg: [1, 2],
  Ti: [4], Zr: [4], Ce: [3, 4], U: [3, 4, 6], Pu: [3, 4],
  F: [-1], Cl: [-1], Br: [-1], I: [-1], At: [-1],
  O: [-2], S: [-2], Se: [-2], Te: [-2],
  N: [-3], P: [-3],
};

/** p-block elements that behave as metals (the rest of the p block is non-metal). */
const P_BLOCK_METALS: ReadonlySet<string> = new Set(["Al", "Ga", "In", "Tl", "Sn", "Pb", "Bi", "Po", "At"]);

/**
 * Elements that form covalent skeletons (organic + main-group chemistry).
 * Disjoint from METALLOIDS, which is what `isSkeletonElement` cares about:
 * both non-metals and metalloids extend skeletons (Si in silicates, B in
 * borates), while noble gases and hydrogen do not.
 */
const NON_METALS: ReadonlySet<string> = new Set([
  "H", "He", "C", "N", "O", "F", "Ne", "P", "S", "Cl", "Ar",
  "Se", "Br", "Kr", "I", "Xe",
]);

/** Metalloids: covalent, but not treated as full non-metals by the classifier. */
const METALLOIDS: ReadonlySet<string> = new Set(["B", "Si", "Ge", "As", "Sb", "Te"]);

/** Canonical element symbol, e.g. "cl" → "Cl". Undefined for unknown input. */
export function canonicalSymbol(symbol: string): string | undefined {
  return tryGetElement(symbol)?.symbol;
}

/** Periodic-table block, or undefined when it cannot be derived (f-block, unknown). */
export function blockOf(symbol: string): Block | undefined {
  const el = tryGetElement(symbol);
  if (!el) return undefined;
  if (el.group === undefined) return "f";
  if (el.group >= 3 && el.group <= 12) return "d";
  if (el.group <= 2) return "s";
  return "p";
}

/** True for main-group (s/p) elements, the ones with predictable valences. */
export function isMainGroup(symbol: string): boolean {
  const block = blockOf(symbol);
  return block === "s" || block === "p";
}

/**
 * Preferred covalent valence: curated value first, then the main-group rule
 * (groups 1/2 → 1/2, groups 13–17 → the octet count), else 0 = "unknown".
 */
export function preferredValence(symbol: string): number {
  const el = tryGetElement(symbol);
  if (!el) return 0;
  const curated = PREFERRED_VALENCE[el.symbol];
  if (curated !== undefined) return curated;
  const g = el.group;
  if (g === undefined) return 0; // f-block with no curated entry
  if (g === 1) return 1;
  if (g === 2) return 2;
  if (g === 18) return 0; // noble gases make no bonds in our model
  if (g >= 3 && g <= 12) return 2; // transition metals: default to the common 2
  if (g >= 13 && g <= 17) return g - 10;
  return 0;
}

/**
 * Ascending list of valence states; empty when the element is unknown.
 *
 * A metal's oxidation states count as valences too, because that is what an
 * oxo species needs: MnO₄⁻ is Mn(VII), four oxygens taking 2+2+2+1 bonds, and
 * Cr₂O₇²⁻ is two Cr(VI). Without them a builder sees only Mn(IV) and leaves
 * permanganate with four single bonds.
 */
export function valenceStates(symbol: string): number[] {
  const el = tryGetElement(symbol);
  if (!el) return [];
  const curated = VALENCE_STATES[el.symbol];
  if (curated !== undefined) return [...curated].sort((a, b) => a - b);
  const oxidation = commonCharges(el.symbol).filter((charge) => charge > 0);
  const states = new Set<number>([preferredValence(el.symbol), ...oxidation]);
  states.delete(0);
  return [...states].sort((a, b) => a - b);
}

/** True when the element can take that many covalent bonds. */
export function hasValence(symbol: string, valence: number): boolean {
  return valenceStates(symbol).includes(valence);
}

/** Signed ionic charges this element commonly carries, ascending. */
export function commonCharges(symbol: string): number[] {
  const el = tryGetElement(symbol);
  if (!el) return [];
  return [...(CHARGES[el.symbol] ?? [])].sort((a, b) => a - b);
}

/** The charge an ion of this element most commonly carries (first positive, else most negative). */
export function preferredCharge(symbol: string): number {
  const charges = commonCharges(symbol);
  const positive = charges.find((c) => c > 0);
  if (positive !== undefined) return positive;
  return charges[0] ?? 0;
}

/** Cation charge used when building an ionic lattice, e.g. Na → +1. */
export function cationCharge(symbol: string): number {
  const charges = commonCharges(symbol);
  return charges.find((c) => c > 0) ?? 0;
}

/** Anion charge used when building an ionic lattice, e.g. Cl → −1. */
export function anionCharge(symbol: string): number {
  const charges = commonCharges(symbol);
  return charges.find((c) => c < 0) ?? 0;
}

export function isMetal(symbol: string): boolean {
  const el = tryGetElement(symbol);
  if (!el) return false;
  if (NON_METALS.has(el.symbol)) return false;
  if (METALLOIDS.has(el.symbol)) return false;
  const block = blockOf(el.symbol);
  if (block === "s" || block === "d" || block === "f") return true;
  return P_BLOCK_METALS.has(el.symbol);
}

export function isNonMetal(symbol: string): boolean {
  const el = tryGetElement(symbol);
  return el !== undefined && NON_METALS.has(el.symbol);
}

export function isMetalloid(symbol: string): boolean {
  const el = tryGetElement(symbol);
  return el !== undefined && METALLOIDS.has(el.symbol);
}

export function isAlkaliMetal(symbol: string): boolean {
  const el = tryGetElement(symbol);
  return el?.group === 1 && el.symbol !== "H";
}

export function isAlkalineEarth(symbol: string): boolean {
  return tryGetElement(symbol)?.group === 2;
}

export function isHalogen(symbol: string): boolean {
  return tryGetElement(symbol)?.group === 17;
}

export function isChalcogen(symbol: string): boolean {
  return tryGetElement(symbol)?.group === 16;
}

export function isNobleGas(symbol: string): boolean {
  return tryGetElement(symbol)?.group === 18;
}

/** Group 15 (pnictogens) — N, P, As, Sb, Bi. */
export function isPnicogen(symbol: string): boolean {
  return tryGetElement(symbol)?.group === 15;
}

/** Elements after carbon that extend covalent skeletons: B, Si, N, P, S, … */
export function isSkeletonElement(symbol: string): boolean {
  const el = tryGetElement(symbol);
  if (!el || el.symbol === "H" || isNobleGas(el.symbol)) return false;
  return isNonMetal(el.symbol) || isMetalloid(el.symbol);
}
