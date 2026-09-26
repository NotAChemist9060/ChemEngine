/**
 * A tiny structural notation so curated structures read like chemistry
 * instead of like `addAtom` call chains.
 *
 *   atom   := Element ( ring | hcount | charge | branch )*
 *   branch := '(' bond chain ')'
 *   chain  := bond? atom ( bond? atom )*
 *   bond   := '=' double | '#' triple          (default single)
 *   ring   := '%' digit                        ring-closure label
 *   hcount := digits | 'H' digits?             hydrogens on the current atom
 *   charge := '+' | '-'                        per atom, additive ("Ca++")
 *
 * `H` is a hydrogen *modifier*, never an atom: hydrogen is always implicit, so
 * a graph can never grow an H node (`molecule.ts` promises this) and the only
 * way to write one is `C(H)(H)(H)H`, `CH4` or `CH`. Because `H` is not an atom,
 * a formula-like `CH4` is unambiguous — there is no reading where that `H`
 * starts a chain.
 *
 * `(H)` is shorthand for one implicit hydrogen on the current atom, never a
 * node — benzene is six atoms, as `molecule.ts` promises. Unless * `fillHydrogens: false` is passed, remaining valences are then topped up with
 * implicit hydrogens (`completeValences`), so a skeleton can be written
 * without spelling out every H.
 *
 * Examples:
 *   "O(H)(H)"                        water
 *   "C(H)(H)(C(H)(H)(O(H)))"         ethanol
 *   "C%1=CC=CC=C%1"                  benzene (label 1 closes the ring)
 *   "C%1(C(H)(H)(H))=CC=CC=C%1"      toluene
 *   "S(=O)(=O)(O(H))(O(H))"          sulfuric acid, molecular form
 *   "O(=S(=O)=O)(O-)O-"              sulfate dianion
 *   "C(H)(H)(H)+"                    ammonium cation
 *
 * Deliberately element-only: polyatomic ions are written as their atoms, never
 * as a unit that would need a lookup table.
 */
import { canonicalSymbol } from "./valence.ts";
import { addAtom, addBond, completeValences, emptyMolecule, netCharge } from "./molecule.ts";
import type { BondOrder, Molecule } from "./molecule.ts";

const RING_SIGIL = "%";

/**
 * Note: no TypeScript parameter properties (`constructor(readonly x: string)`)
 * anywhere in this repo — Node's strip-only type stripping rejects them, and
 * `node src/cli/index.ts` must keep working without a build step.
 */
class Cursor {
  i = 0;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  peek(offset = 0): string | undefined {
    return this.text[this.i + offset];
  }

  next(): string {
    const c = this.text[this.i];
    if (c === undefined) throw error(this.text, this.i, "unexpected end of input");
    this.i++;
    return c;
  }

  expect(char: string): void {
    const c = this.next();
    if (c !== char) throw error(this.text, this.i - 1, `expected '${char}' but found '${c}'`);
  }
}

function error(text: string, at: number, message: string): Error {
  return new Error(`structure DSL '${text}': ${message} (at position ${at})`);
}

function readSymbol(cur: Cursor): string {
  const start = cur.i;
  const first = cur.next();
  if (!/[A-Z]/.test(first)) throw error(cur.text, start, `expected an element symbol, found '${first}'`);
  if (cur.peek() !== undefined && /[a-z]/.test(cur.peek()!)) cur.next();
  const symbol = cur.text.slice(start, cur.i);
  const canonical = canonicalSymbol(symbol);
  if (canonical === undefined) throw error(cur.text, start, `'${symbol}' is not an element symbol`);
  if (canonical === "H") {
    throw error(
      cur.text,
      start,
      "hydrogen is written as a modifier, not an atom — use (H), H2 or a trailing count",
    );
  }
  return canonical;
}

function readRingLabel(cur: Cursor): string {
  const at = cur.i;
  cur.expect(RING_SIGIL);
  const digit = cur.next();
  if (!/[0-9]/.test(digit)) throw error(cur.text, at, `ring label must be a digit, found '${RING_SIGIL}${digit}'`);
  return digit;
}

interface OpenRing {
  atom: number;
  order: BondOrder;
}

/**
 * Reads atoms until the chain can continue no further, returning the index of
 * the last atom read (`start` when the chain is empty). Ring labels opened here
 * but never closed are an error, so a typo cannot silently drop a bond.
 */
function readChain(mol: Molecule, cur: Cursor, start: number | null, open: Map<string, OpenRing>): number {
  let current = start;
  for (;;) {
    let order: BondOrder = 1;
    const c = cur.peek();
    if (c === "=" || c === "#") {
      if (current === null) {
        throw error(cur.text, cur.i, `cannot start a chain with a bond ('${c}')`);
      }
      cur.next();
      order = c === "=" ? 2 : 3;
    } else if (c === RING_SIGIL) {
      throw error(cur.text, cur.i, "ring label must follow an atom");
    } else if (c === ")" || c === undefined) {
      return current === null ? -1 : current;
    }

    const symbol = readSymbol(cur);
    const atom = addAtom(mol, symbol);
    if (current !== null) addBond(mol, current, atom, order);
    current = atom;

    let hydrogens = 0;
    for (;;) {
      const m = cur.peek();
      if (m === undefined) break;
      if (m === "(") {
        cur.next();
        if (cur.peek() === "H" && cur.peek(1) === ")") {
          cur.next();
          cur.next();
          hydrogens += 1; // (H) is an implicit hydrogen, never a node
          continue;
        }
        readChain(mol, cur, atom, open);
        cur.expect(")");
        continue;
      }
      if (m === RING_SIGIL || ((m === "=" || m === "#") && cur.peek(1) === RING_SIGIL)) {
        let ringOrder: BondOrder = 1;
        if (m !== RING_SIGIL) {
          ringOrder = m === "=" ? 2 : 3;
          cur.next();
        }
        const label = readRingLabel(cur);
        const existing = open.get(label);
        if (existing === undefined) {
          open.set(label, { atom, order: ringOrder });
        } else {
          open.delete(label);
          addBond(mol, existing.atom, atom, ringOrder === 1 ? existing.order : ringOrder);
        }
        continue;
      }
      if (m === "=" || m === "#") break; // a chain bond: the outer loop takes it
      if (m === "H") {
        cur.next();
        let n = 0;
        let digits = 0;
        while (cur.peek() !== undefined && cur.peek()! >= "0" && cur.peek()! <= "9") {
          n = n * 10 + (cur.next().charCodeAt(0) - 48);
          digits++;
        }
        hydrogens += digits === 0 ? 1 : n; // H → 1, H4 → 4
        continue;
      }
      if (m >= "0" && m <= "9") {
        let n = 0;
        while (cur.peek() !== undefined && cur.peek()! >= "0" && cur.peek()! <= "9") {
          n = n * 10 + (cur.next().charCodeAt(0) - 48);
        }
        hydrogens += n;
        continue;
      }
      if (m === "+" || m === "-") {
        mol.atoms[atom]!.charge += m === "+" ? 1 : -1;
        cur.next();
        continue;
      }
      break;
    }
    mol.atoms[atom]!.hydrogens += hydrogens;
  }
}

export interface ParseStructureOptions {
  /**
   * Top up unfilled valences with implicit hydrogens (default true). Set false
   * to see the skeleton exactly as written.
   */
  fillHydrogens?: boolean;
}

/** Parses one covalent fragment. A charged fragment (an ion) is allowed. */
export function parseStructure(text: string, options: ParseStructureOptions = {}): Molecule {
  const mol = emptyMolecule();
  const cur = new Cursor(text);
  if (cur.peek() === undefined) throw error(text, 0, "empty structure");
  const open = new Map<string, OpenRing>();
  const last = readChain(mol, cur, null, open);
  if (last < 0) throw error(text, 0, "empty structure");
  if (cur.i < text.length) throw error(text, cur.i, `unexpected trailing input '${text.slice(cur.i)}'`);
  const unclosed = [...open.keys()].sort();
  if (unclosed.length > 0) {
    throw error(text, unclosed.length, `ring label(s) ${unclosed.map((l) => `%${l}`).join(", ")} never closed`);
  }
  if (options.fillHydrogens !== false) completeValences(mol);
  return mol;
}

/** Copies `source` into `target`, offsetting atom indices so bonds stay valid. */
export function mergeInto(target: Molecule, source: Molecule): void {
  const offset = target.atoms.length;
  for (const atom of source.atoms) {
    addAtom(target, atom.symbol, { charge: atom.charge, hydrogens: atom.hydrogens });
  }
  for (const bond of source.bonds) {
    addBond(target, bond.a + offset, bond.b + offset, bond.order);
  }
}

/**
 * Parses several fragments as separate, unbonded ions — the shape a salt
 * takes. The total charge must be zero unless `allowCharged` is set, which
 * keeps a typo such as a missing cation from silently producing a "salt".
 */
export function parseIonSet(texts: readonly string[], options: { allowCharged?: boolean } = {}): Molecule {
  const mol = emptyMolecule();
  for (const text of texts) mergeInto(mol, parseStructure(text));
  const charge = netCharge(mol);
  if (charge !== 0 && options.allowCharged !== true) {
    const sign = charge > 0 ? "+" : "-";
    throw new Error(
      `ion set [${texts.join(", ")}] has net charge ${sign}${Math.abs(charge)}; ` +
        "pass allowCharged to build a charged species",
    );
  }
  return mol;
}
