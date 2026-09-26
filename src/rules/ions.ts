/**
 * Ions: splitting a species into them, and building a salt back out of them.
 *
 * **The split is read off the graph, not off the string.** `structure/` already
 * builds a salt as separate fragments with formal charges on the atoms, so the
 * ions are the connected components and their net charges — the same answer a
 * chemist gets by looking at the structure, and not a heuristic that guesses
 * where to cut `Na2SO4` in half. That matters for the two places it is easy to
 * be wrong: `FeCl3` really does come back as Fe³⁺ + 3 Cl⁻, and `NH4Cl` as
 * NH₄⁺ + Cl⁻ rather than as something with a metal in it.
 *
 * **A salt is rebuilt from charge balance, not from a lookup table.** Given
 * Al³⁺ and SO₄²⁻ the ratio is decided by the charges (2 : 3) and the formula
 * written `Al2(SO4)3`; given Ca²⁺ and OH⁻ it is `Ca(OH)2`. The output parses,
 * so its thermo key is the same whichever spelling is used, and the parenthesised
 * form is the one a textbook prints.
 *
 * One honest limitation: the cation is written first, which is right for
 * inorganic salts and wrong for the organic ones — CH₃COONa comes out as
 * `NaCH3COO`. That is the same species and the same ΔGf° (the table is keyed on
 * Hill-order counts, not on spelling), only spelled the way a machine would.
 */
import { components, neighbors, type Molecule } from "../structure/molecule.ts";
import { formatFormula, parseFormula } from "../core/formula.ts";
import { splitChargedFormula } from "../thermo/table.ts";
import type { SpeciesInput } from "./types.ts";

/** One ion: its atoms, its net charge, and a spelling for display. */
export interface Ion {
  /** Ion formula without the charge, e.g. "SO4", "Na", "CH3COO". */
  formula: string;
  /** Net formal charge; negative for an anion, 0 for a neutral fragment. */
  charge: number;
  /** Element symbol → atom count, implicit hydrogens included. */
  counts: Map<string, number>;
}

/** A species taken apart into its ions. */
export interface IonSplit {
  cations: Ion[];
  anions: Ion[];
  /** Charge-0 fragments: the water in a hydrate, an uncharged molecule. */
  neutrals: Ion[];
}

/**
 * The ions a species is made of, or `undefined` when it is not a salt.
 *
 * `undefined` is the honest answer for anything without a structure (`molecule:
 * null`, e.g. `CH3COONa` today) and for a single neutral fragment. A caller
 * that needs to tell those apart reads `structure.molecule` itself.
 */
export function splitIons(species: SpeciesInput): IonSplit | undefined {
  const molecule = species.structure.molecule;
  if (molecule === null) return undefined;
  const parts = components(molecule).map((indices) => ionOfFragment(molecule, indices));
  const split: IonSplit = { cations: [], anions: [], neutrals: [] };
  for (const part of parts) {
    if (part.charge > 0) split.cations.push(part);
    else if (part.charge < 0) split.anions.push(part);
    else split.neutrals.push(part);
  }
  // Not a salt if nothing carries a charge, or if it is all one sign: a
  // "cation" with no anion is a bare metal, and a bare anion has no counterion.
  if (split.cations.length === 0 || split.anions.length === 0) return undefined;
  return split;
}

/** True when the species splits cleanly into ions with nothing else attached. */
export function isSimpleSalt(species: SpeciesInput): boolean {
  const split = splitIons(species);
  return split !== undefined && split.neutrals.length === 0;
}

/**
 * The formula of a salt made of these ions, e.g. Al³⁺ + SO₄²⁻ → `Al2(SO4)3`.
 *
 * The ratio is the smallest whole-number one that balances the charges, so
 * Ca²⁺ + 2 Cl⁻ gives `CaCl2` and Na⁺ + SO₄²⁻ gives `Na2SO4`. Throws for a
 * same-sign or charge-free pair: no such salt exists, and a rule that reached
 * here has a bug worth hearing about.
 */
export function buildSalt(cation: Ion, anion: Ion): string {
  if (cation.charge <= 0) throw new Error(`buildSalt: ${cation.formula} is not a cation`);
  if (anion.charge >= 0) throw new Error(`buildSalt: ${anion.formula} is not an anion`);
  const divisor = gcd(cation.charge, -anion.charge);
  const cationCount = -anion.charge / divisor;
  const anionCount = cation.charge / divisor;
  return `${ionPart(cation, cationCount)}${ionPart(anion, anionCount)}`;
}

/**
 * One part of a salt formula: `Na2`, `Ca`, `SO4`, `(SO4)3`, `(OH)2`.
 *
 * A repeated group keeps its own spelling and takes the multiplier outside the
 * brackets, which is the notation (`(SO4)3`, not `(SO12)3`) and the only one
 * that means anything. Nothing is re-sorted here: the ion already knows how it
 * reads, and re-deriving it in Hill order is what would turn `K2SO4` into
 * `K2O4S`.
 */
function ionPart(ion: Ion, count: number): string {
  if (count === 1) return ion.formula;
  if (ion.counts.size === 1) {
    const [symbol, each] = [...ion.counts][0]!;
    return atomText(symbol, each * count);
  }
  return `(${ion.formula})${count}`;
}

/**
 * An ion written by hand, e.g. "SO4^2-" or "CH3COO-".
 *
 * Rules that need an ion the structure layer did not supply (the conjugate base
 * of an acid, say) write it as a formula and read it here, so the charge suffix
 * is understood the same way everywhere in the engine.
 */
export function ionFromFormula(formula: string): Ion | undefined {
  const split = splitChargedFormula(formula);
  if (split === undefined) return undefined;
  // splitChargedFormula has already parsed the atom part, so this cannot throw.
  return {
    formula: split.atoms,
    charge: split.charge,
    counts: new Map(parseFormula(split.atoms).elements),
  };
}

/** How an ion reads in a sentence, e.g. `SO4^2-` for −2. */
export function ionLabel(ion: Ion): string {
  if (ion.charge === 0) return ion.formula;
  const magnitude = Math.abs(ion.charge);
  return `${ion.formula}${ion.charge > 0 ? "+" : "-"}${magnitude === 1 ? "" : magnitude}`;
}

/**
 * One ion read off a fragment of the graph.
 *
 * The atom order comes from the connectivity: the atom with the most bonds
 * inside the fragment goes first, which is the atom a chemist would call the
 * centre. That is what turns the sulfate fragment into `SO4` and the hydroxide
 * into `OH` instead of the Hill-order `O4S` and `HO`, and it is a fact about
 * the graph rather than a table of preferred spellings.
 */
function ionOfFragment(mol: Molecule, indices: readonly number[]): Ion {
  const inside = new Set(indices);
  const counts = new Map<string, number>();
  let charge = 0;
  let centre = -1;
  let degree = -1;
  for (const index of indices) {
    const atom = mol.atoms[index]!;
    counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1);
    if (atom.hydrogens > 0) counts.set("H", (counts.get("H") ?? 0) + atom.hydrogens);
    charge += atom.charge;
    const bonded = neighbors(mol, index).filter((n) => inside.has(n)).length;
    if (bonded > degree) {
      degree = bonded;
      centre = index;
    }
  }
  return { formula: orderFragment(mol, counts, centre), charge, counts };
}

/**
 * The ion's formula with the centre atom first.
 *
 * One heavy atom with hydrogens on it reads as that atom then the hydrogens
 * (`OH`, `NH4`), which is the convention. Otherwise the connected atom is
 * promoted when it occurs exactly once in the fragment — that is what turns the
 * sulfate fragment into `SO4` rather than Hill-order `O4S` — and a fragment
 * where the promotion would be nonsense, an acetate with two carbons, keeps
 * Hill order and is spelled the machine way.
 */
function orderFragment(mol: Molecule, counts: Map<string, number>, centre: number): string {
  if (counts.size === 1) return formatFormula(counts);
  const heavy = [...counts.keys()].filter((symbol) => symbol !== "H");
  if (heavy.length === 1) {
    const symbol = heavy[0]!;
    const hydrogens = counts.get("H") ?? 0;
    const tail = hydrogens === 0 ? "" : `H${hydrogens === 1 ? "" : hydrogens}`;
    return `${atomText(symbol, counts.get(symbol)!)}${tail}`;
  }
  const symbol = centre >= 0 ? mol.atoms[centre]!.symbol : undefined;
  if (symbol !== undefined && counts.get(symbol) === 1) {
    const rest = new Map(counts);
    rest.delete(symbol);
    return `${atomText(symbol, 1)}${formatFormula(rest)}`;
  }
  return formatFormula(counts);
}

/** `S`, `O4`, `H10` — an element and its count, the count omitted when it is one. */
function atomText(symbol: string, count: number): string {
  return count === 1 ? symbol : `${symbol}${count}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}
