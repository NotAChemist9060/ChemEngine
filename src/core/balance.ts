import type { ChemicalEquation, StoichTerm } from "./equation.ts";
import {
  rat, ratAdd, ratDiv, ratIsZero, ratMul, ratScaleToInts, ratSub,
  type Rational,
} from "../util/rational.ts";

export interface BalancedEquation {
  equation: ChemicalEquation;
  /** Smallest positive integer coefficients, aligned with reactants then products. */
  coefficients: number[];
  /** Conserved elements used for the balance. */
  elements: string[];
}

/**
 * Balance a chemical equation using exact rational arithmetic.
 * Builds element-conservation rows and solves the homogeneous linear system
 * via Gauss-Jordan elimination, then scales the rational solution to the
 * smallest positive integers. Throws for impossible equations.
 */
export function balanceEquation(eq: ChemicalEquation): BalancedEquation {
  const species: StoichTerm[] = [...eq.reactants, ...eq.products];
  const n = species.length;

  // Element symbols in first-seen order.
  const elements: string[] = [];
  const seen = new Set<string>();
  for (const sp of species) {
    for (const sym of sp.counts.keys()) {
      if (!seen.has(sym)) {
        seen.add(sym);
        elements.push(sym);
      }
    }
  }
  const m = elements.length;

  // Matrix A: rows = elements, cols = species.
  // Reactant entries positive, product entries negative (Σ side·count·coeff = 0).
  const A: Rational[][] = Array.from({ length: m }, () =>
    Array.from({ length: n }, () => rat(0n)),
  );
  for (let r = 0; r < m; r++) {
    const sym = elements[r]!;
    for (let c = 0; c < n; c++) {
      const count = BigInt(species[c]!.counts.get(sym) ?? 0);
      const side = c < eq.reactants.length ? 1n : -1n;
      A[r]![c] = rat(side * count, 1n);
    }
  }

  // Gauss-Jordan elimination to reduced row echelon form.
  const pivotColOfRow = new Map<number, number>();
  let row = 0;
  for (let col = 0; col < n && row < m; col++) {
    let pr = -1;
    for (let r = row; r < m; r++) {
      if (!ratIsZero(A[r]![col]!)) {
        pr = r;
        break;
      }
    }
    if (pr === -1) continue;
    [A[row], A[pr]] = [A[pr]!, A[row]!];
    const pivot = A[row]![col]!;
    for (let c = 0; c < n; c++) A[row]![c] = ratDiv(A[row]![c]!, pivot);
    for (let r = 0; r < m; r++) {
      if (r === row) continue;
      const f = A[r]![col]!;
      if (ratIsZero(f)) continue;
      for (let c = 0; c < n; c++) A[r]![c] = ratSub(A[r]![c]!, ratMul(f, A[row]![c]!));
    }
    pivotColOfRow.set(row, col);
    row++;
  }

  // Nullspace: free columns represent degrees of freedom.
  const isPivotCol = new Set(pivotColOfRow.values());
  const freeCols: number[] = [];
  for (let c = 0; c < n; c++) if (!isPivotCol.has(c)) freeCols.push(c);
  if (freeCols.length === 0) {
    throw new Error(`equation cannot be balanced: atom counts are inconsistent (${eq.input})`);
  }

  // Set free variables to 1, solve pivots from RREF rows.
  const x: Rational[] = Array.from({ length: n }, () => rat(0n));
  for (const c of freeCols) x[c] = rat(1n);
  for (const [r, col] of pivotColOfRow) {
    let acc = rat(0n);
    for (const fc of freeCols) acc = ratSub(acc, ratMul(A[r]![fc]!, rat(1n)));
    x[col] = acc;
  }

  // Verify conservation exactly.
  for (const sym of elements) {
    let bal = rat(0n);
    for (let c = 0; c < n; c++) {
      const count = BigInt(species[c]!.counts.get(sym) ?? 0);
      const side = c < eq.reactants.length ? 1n : -1n;
      bal = ratAdd(bal, ratMul(x[c]!, rat(side * count, 1n)));
    }
    if (!ratIsZero(bal)) {
      throw new Error(`internal error: balanced solution failed conservation for ${sym}`);
    }
  }

  // Scale to smallest positive integers.
  const ints = ratScaleToInts(x);
  if (ints.some((v) => v <= 0n)) {
    throw new Error(`equation cannot be balanced with positive coefficients (${eq.input})`);
  }
  const coefficients = ints.map((v) => Number(v));
  return { equation: eq, coefficients, elements };
}

/** Render a balanced equation, e.g. "CH4 + 2O2 -> CO2 + 2H2O". */
export function formatBalancedEquation(b: BalancedEquation): string {
  const fmtSide = (species: StoichTerm[], coeffs: number[], startIdx: number): string =>
    species
      .map((sp, i) => {
        const k = coeffs[startIdx + i]!;
        return `${k === 1 ? "" : `${k}`}${sp.formula}`;
      })
      .join(" + ");
  const arrow = b.equation.reversible ? "<=>" : "->";
  const lhs = fmtSide(b.equation.reactants, b.coefficients, 0);
  const rhs = fmtSide(b.equation.products, b.coefficients, b.equation.reactants.length);
  return `${lhs} ${arrow} ${rhs}`;
}