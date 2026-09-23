import { describe, expect, it } from "vitest";
import { balanceEquation, formatBalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";

function balanced(input: string): string {
  return formatBalancedEquation(balanceEquation(parseEquation(input)));
}

describe("equation balancer", () => {
  it("balances methane combustion", () => {
    expect(balanced("CH4 + O2 -> CO2 + H2O")).toBe("CH4 + 2O2 -> CO2 + 2H2O");
  });

  it("balances hydrogen combustion", () => {
    expect(balanced("H2 + O2 -> H2O")).toBe("2H2 + O2 -> 2H2O");
  });

  it("balances hydrogen peroxide decomposition", () => {
    expect(balanced("H2O2 -> H2O + O2")).toBe("2H2O2 -> 2H2O + O2");
  });

  it("balances iron rusting", () => {
    expect(balanced("Fe + O2 -> Fe2O3")).toBe("4Fe + 3O2 -> 2Fe2O3");
  });

  it("balances a multi-free-variable system", () => {
    expect(balanced("C + O2 -> CO + CO2")).toBe("4C + 3O2 -> 2CO + 2CO2");
  });

  it("balances single displacement", () => {
    expect(balanced("Zn + HCl -> ZnCl2 + H2")).toBe("Zn + 2HCl -> ZnCl2 + H2");
    expect(balanced("Na + H2O -> NaOH + H2")).toBe("2Na + 2H2O -> 2NaOH + H2");
  });

  it("balances the classic permanganate redox", () => {
    expect(balanced("KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O")).toBe(
      "2KMnO4 + 16HCl -> 2KCl + 2MnCl2 + 5Cl2 + 8H2O",
    );
  });

  it("balances reversible equations", () => {
    expect(balanced("N2 + H2 <=> NH3")).toBe("N2 + 3H2 <=> 2NH3");
  });

  it("keeps conservation intact for several equations", () => {
    for (const eq of [
      "C6H12O6 + O2 -> CO2 + H2O",
      "Al + Fe2O3 -> Al2O3 + Fe",
      "NH3 + O2 -> NO + H2O",
      "P4 + O2 -> P2O5",
      "C3H8 + O2 -> CO2 + H2O",
    ]) {
      const b = balanceEquation(parseEquation(eq));
      const counts = (t: { counts: Map<string, number> }, k: number) =>
        new Map([...t.counts].map(([sym, n]) => [sym, n * k]));
      const lhs = new Map<string, number>();
      const rhs = new Map<string, number>();
      b.equation.reactants.forEach((t, i) => merge(lhs, counts(t, b.coefficients[i]!)));
      b.equation.products.forEach((t, i) => merge(rhs, counts(t, b.coefficients[b.equation.reactants.length + i]!)));
      expect(Object.fromEntries(lhs)).toEqual(Object.fromEntries(rhs));
    }
  });

  it("rejects equations with no positive solution", () => {
    expect(() => balanced("CH4 -> C2H6")).toThrow(/cannot be balanced/);
  });

  it("normalizes unbalanced written coefficients", () => {
    // Written coefficients are hints; the balancer recomputes the true balance.
    expect(balanced("2H2 + O2 -> 3H2O")).toBe("2H2 + O2 -> 2H2O");
  });

  it("balances a single-species tautology", () => {
    expect(balanced("O2 -> O2")).toBe("O2 -> O2");
  });
});

function merge(target: Map<string, number>, src: Map<string, number>): void {
  for (const [k, v] of src) target.set(k, (target.get(k) ?? 0) + v);
}