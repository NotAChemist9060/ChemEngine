import { parseFormula, type FormulaResult } from "./formula.ts";
import { rat, ratFromDecimal, type Rational } from "../util/rational.ts";

export type PhysicalState = "s" | "l" | "g" | "aq";

export interface StoichTerm {
  /** Rational coefficient as written (defaults to 1). */
  coefficient: Rational;
  /** Canonical formula. */
  formula: string;
  /** Element symbol → atom count. */
  counts: Map<string, number>;
  /** Optional physical state, e.g. (aq), (g). */
  state?: PhysicalState;
}

export interface ChemicalEquation {
  input: string;
  reactants: StoichTerm[];
  products: StoichTerm[];
  /** True when written with '<=>' or '⇌'. */
  reversible: boolean;
}

const ARROW = /(<=>|⇌|->|→|⟶|=>|=)/;
// Fraction tried first so "1/2H2" yields coefficient 1/2, not 1 with a stray "/2".
const COEFFICIENT = /^(\d+\s*\/\s*\d+|\.\d+|\d+(?:\.\d+)?)/;
const STATE = /\((s|l|g|aq)\)$/i;

/**
 * Parse a chemical equation string tolerant of spaces and missing
 * coefficients. Examples:
 *   "2H2 + O2 -> 2H2O"
 *   "N2 + 3H2 <=> 2NH3"          (reversible)
 *   "NaCl(s) + AgNO3(aq) -> AgCl(s) + NaNO3(aq)"   (optional states)
 *   "1/2H2 + 1/2O2 -> H2O"       (fractional coefficients allowed)
 */
export function parseEquation(input: string): ChemicalEquation {
  const s = input.trim().replace(/\s+/g, " ");
  const arrowMatch = ARROW.exec(s);
  if (!arrowMatch) throw new Error(`equation '${input}': missing arrow (use '->' for forward or '<=>' for reversible)`);
  const arrow = arrowMatch[1]!;
  const idx = arrowMatch.index;
  const lhs = s.slice(0, idx).trim();
  const rhs = s.slice(idx + arrow.length).trim();
  if (!lhs || !rhs) throw new Error(`equation '${input}': incomplete — need both reactants and products`);
  return {
    input,
    reactants: parseSide(lhs),
    products: parseSide(rhs),
    reversible: arrow === "<=>" || arrow === "⇌",
  };
}

function parseSide(side: string): StoichTerm[] {
  const terms = side.split("+").map((t) => t.trim()).filter((t) => t.length > 0);
  if (terms.length === 0) throw new Error(`invalid side '${side}'`);
  return terms.map(parseTerm);
}

function parseTerm(raw: string): StoichTerm {
  let rest = raw;
  let coefficient: Rational = rat(1n);

  const coefMatch = COEFFICIENT.exec(rest);
  if (coefMatch && coefMatch[1] !== undefined) {
    const c = coefMatch[1];
    if (c.includes("/")) {
      const [n, d] = c.split("/").map((x) => x.trim());
      coefficient = rat(BigInt(n!), BigInt(d!));
    } else {
      coefficient = ratFromDecimal(c);
    }
    rest = rest.slice(coefMatch[0].length).trim();
  }

  let state: PhysicalState | undefined;
  const stateMatch = STATE.exec(rest);
  if (stateMatch && stateMatch[1] !== undefined) {
    const st = stateMatch[1].toLowerCase();
    state = st as PhysicalState;
    rest = rest.slice(0, -stateMatch[0].length).trim();
  }

  if (!rest) throw new Error(`invalid term '${raw}'`);
  const formula: FormulaResult = parseFormula(rest);

  const term: StoichTerm = {
    coefficient,
    formula: formula.formula,
    counts: formula.elements,
  };
  if (state !== undefined) term.state = state;
  return term;
}