/**
 * Lightweight connectivity graph: atoms and bonds, no geometry, no
 * stereochemistry (see plan §7 — a swappable backend comes later).
 *
 * **Hydrogens are implicit.** An atom carries a `hydrogens` count instead of
 * owning H nodes, so benzene is 6 atoms rather than 12. `formulaOf` adds them
 * back, which is what makes graph → formula → parse round-trips exact.
 *
 * Building is mutating (`addAtom`/`addBond` return indices) because templates
 * read far better as imperative scripts; everything else is a pure query.
 */
import { formatFormula } from "../core/formula.ts";
import { isMetal, isNobleGas, preferredValence } from "./valence.ts";

export type BondOrder = 1 | 2 | 3;

export interface Atom {
  /** Position in `Molecule.atoms`; stable for the life of the molecule. */
  index: number;
  /** Canonical element symbol, e.g. "C". */
  symbol: string;
  /** Formal charge carried by this atom (0 unless the caller set one). */
  charge: number;
  /** Hydrogens attached to this atom, not represented as nodes. */
  hydrogens: number;
}

export interface Bond {
  a: number;
  b: number;
  order: BondOrder;
}

export interface Molecule {
  atoms: Atom[];
  bonds: Bond[];
}

/** Atom options accepted by `addAtom`; `index` and `symbol` are not optional there. */
export interface AtomOptions {
  charge?: number;
  hydrogens?: number;
}

export function emptyMolecule(): Molecule {
  return { atoms: [], bonds: [] };
}

export function atomCount(mol: Molecule): number {
  return mol.atoms.length;
}

/** Appends an atom and returns its index. */
export function addAtom(mol: Molecule, symbol: string, options: AtomOptions = {}): number {
  const index = mol.atoms.length;
  mol.atoms.push({
    index,
    symbol,
    charge: options.charge ?? 0,
    hydrogens: options.hydrogens ?? 0,
  });
  return index;
}

/**
 * Appends a bond between two atom indices. Throws on out-of-range or
 * self-bonds: those are caller bugs, not chemistry unknowns, so they must
 * not be silently dropped.
 */
export function addBond(mol: Molecule, a: number, b: number, order: BondOrder = 1): void {
  assertAtomIndex(mol, a);
  assertAtomIndex(mol, b);
  if (a === b) throw new Error(`bond cannot connect atom ${a} to itself`);
  if (findBond(mol, a, b)) throw new Error(`duplicate bond between atoms ${a} and ${b}`);
  mol.bonds.push({ a, b, order });
}

function assertAtomIndex(mol: Molecule, i: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= mol.atoms.length) {
    throw new Error(`atom index ${i} out of range (molecule has ${mol.atoms.length} atoms)`);
  }
}

/** The bond joining a and b in either direction, if present. */
export function findBond(mol: Molecule, a: number, b: number): Bond | undefined {
  return mol.bonds.find((bond) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a));
}

/** Neighbouring atom indices (bond order ignored). */
export function neighbors(mol: Molecule, index: number): number[] {
  assertAtomIndex(mol, index);
  const out: number[] = [];
  for (const bond of mol.bonds) {
    if (bond.a === index) out.push(bond.b);
    else if (bond.b === index) out.push(bond.a);
  }
  return out;
}

/** Number of heavy-atom neighbours. */
export function degree(mol: Molecule, index: number): number {
  return neighbors(mol, index).length;
}

/** Sum of bond orders at an atom — its current bonding capacity in use. */
export function bondedOrder(mol: Molecule, index: number): number {
  assertAtomIndex(mol, index);
  let sum = 0;
  for (const bond of mol.bonds) if (bond.a === index || bond.b === index) sum += bond.order;
  return sum;
}

/** Neighbours reached by a bond of exactly `order`. */
export function neighborsByOrder(mol: Molecule, index: number, order: BondOrder): number[] {
  assertAtomIndex(mol, index);
  const out: number[] = [];
  for (const bond of mol.bonds) {
    if (bond.order !== order) continue;
    if (bond.a === index) out.push(bond.b);
    else if (bond.b === index) out.push(bond.a);
  }
  return out;
}

/** Net formal charge of the whole graph. */
export function netCharge(mol: Molecule): number {
  return mol.atoms.reduce((sum, atom) => sum + atom.charge, 0);
}

/** Element counts for the entire graph, implicit hydrogens included. */
export function formulaOf(mol: Molecule): Map<string, number> {
  const counts = new Map<string, number>();
  for (const atom of mol.atoms) {
    counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1);
    if (atom.hydrogens > 0) counts.set("H", (counts.get("H") ?? 0) + atom.hydrogens);
  }
  return counts;
}

/** Hill-order formula text for the graph, e.g. "C6H6", "H2O", "NaCl". */
export function formulaString(mol: Molecule): string {
  return formatFormula(formulaOf(mol));
}

/**
 * Connected components of the heavy-atom graph, each as ascending atom
 * indices. A salt has one component per ion; a hydrate is one component.
 */
export function components(mol: Molecule): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const atom of mol.atoms) {
    if (seen.has(atom.index)) continue;
    const stack = [atom.index];
    const group: number[] = [];
    seen.add(atom.index);
    while (stack.length > 0) {
      const i = stack.pop()!;
      group.push(i);
      for (const n of neighbors(mol, i)) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    out.push(group.sort((x, y) => x - y));
  }
  return out;
}

/** Independent cycles in the graph: bonds − atoms + components. */
export function ringCount(mol: Molecule): number {
  return mol.bonds.length - mol.atoms.length + components(mol).length;
}

/**
 * Atoms that sit on a simple cycle of exactly `size` atoms (ignoring bond
 * order), e.g. `atomsInRing(mol, 6)` for a benzene ring.
 */
export function atomsInRing(mol: Molecule, size: number): number[] {
  const found = new Set<number>();
  const path: number[] = [];
  const visited = new Set<number>();
  const walk = (index: number, start: number): void => {
    if (path.length > size) return;
    path.push(index);
    visited.add(index);
    for (const n of neighbors(mol, index)) {
      if (n === start && path.length === size) {
        for (const p of path) found.add(p);
        return;
      }
      if (!visited.has(n) && path.length < size) walk(n, start);
    }
    path.pop();
    visited.delete(index);
  };
  for (const atom of mol.atoms) {
    path.length = 0;
    visited.clear();
    walk(atom.index, atom.index);
  }
  return [...found].sort((a, b) => a - b);
}

/** True when every heavy atom of the graph has the given symbol. */
export function allAtomsAre(mol: Molecule, symbol: string): boolean {
  return mol.atoms.length > 0 && mol.atoms.every((atom) => atom.symbol === symbol);
}

/** Counts by element symbol, heavy atoms only. */
export function symbolCounts(mol: Molecule): Map<string, number> {
  const counts = new Map<string, number>();
  for (const atom of mol.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1);
  return counts;
}

export interface CompleteValencesOptions {
  /** Leave charged atoms alone — an ion's hydrogens are stated, not inferred. */
  skipCharged?: boolean;
  /** Leave metals and noble gases alone: preferredValence models neither well. */
  skipMetalsAndNobleGases?: boolean;
}

/**
 * Tops up implicit hydrogens so each atom reaches its preferred valence
 * (`bondedOrder + hydrogens`), and returns how many were added.
 *
 * Atoms already at or over capacity are untouched, so an explicit
 * `S(=O)(=O)(O(H))(O(H))` is left alone. This is the one place hydrogens are
 * inferred rather than written down, which is why it is opt-out per group.
 */
export function completeValences(mol: Molecule, options: CompleteValencesOptions = {}): number {
  const { skipCharged = true, skipMetalsAndNobleGases = true } = options;
  let added = 0;
  for (const atom of mol.atoms) {
    if (skipCharged && atom.charge !== 0) continue;
    if (skipMetalsAndNobleGases && (isMetal(atom.symbol) || isNobleGas(atom.symbol))) continue;
    const target = preferredValence(atom.symbol);
    const used = bondedOrder(mol, atom.index) + atom.hydrogens;
    if (target > used) {
      atom.hydrogens += target - used;
      added += target - used;
    }
  }
  return added;
}

/** Structural copy — `cloneMolecule(build).` is how templates get reused safely. */
export function cloneMolecule(mol: Molecule): Molecule {
  return {
    atoms: mol.atoms.map((atom) => ({ ...atom })),
    bonds: mol.bonds.map((bond) => ({ ...bond })),
  };
}
