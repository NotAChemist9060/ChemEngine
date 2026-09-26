/**
 * Combination, checked against the curated table.
 *
 * The classics are pinned to the table's numbers: Mg + O₂ at −1138.6,
 * H₂ + O₂ at −474.26, C + O₂ at −394.36 (T4's own pin), CaO + CO₂ at
 * −131.01 — the mirror of decomposition's +131.01, which the two entries
 * hand each other through the same ΔGf° values. The plan's negative, N₂ + O₂,
 * must come back as a decline with the endothermic reason; iron's two oxides
 * get the same treatment for ambiguity, and any pair the curated table does not
 * hold is told so plainly — "no entry" is never silence.
 */
import { describe, expect, it } from "vitest";
import { combination } from "../src/rules/combination.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { balanceEquation, type BalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!combination.applies(ctx)) return [];
  return combination.propose(ctx).proposals;
}

function declined(...tokens: string[]) {
  return combination.propose(context(...tokens)).declined;
}

function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one combination of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("the gate", () => {
  it("opens for any pair of species", () => {
    expect(combination.applies(context("Mg", "O2"))).toBe(true);
    expect(combination.applies(context("N2", "O2"))).toBe(true);
    expect(combination.applies(context("Mg", "N2"))).toBe(true);
  });

  it("stays quiet for a single species — decomposition's question", () => {
    for (const input of [["Mg"], ["CH4"], ["H2O"]]) {
      expect(combination.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("the elements combine", () => {
  it("burns magnesium to magnesium oxide, at the pinned value", () => {
    const result = balanced("Mg", "O2");
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["MgO(s)"]);
    expect(result.coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("Mg", "O2")).toBeCloseTo(-1138.6, 2);
    expect(proposals("Mg", "O2")[0]!.reasoning).toContain("magnesium and oxygen combine");
  });

  it("makes water with a bang", () => {
    expect(balanced("H2", "O2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("H2", "O2")).toBeCloseTo(-474.26, 2);
  });

  it("sprinkles salt from sodium and chlorine", () => {
    expect(balanced("Na", "Cl2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("Na", "Cl2")).toBeCloseTo(-768.28, 2);
  });

  it("burns carbon to carbon dioxide, at T4's own pin", () => {
    const result = balanced("C", "O2");
    expect(result.coefficients).toEqual([1, 1, 1]);
    expect(dGrxn("C", "O2")).toBeCloseTo(-394.36, 2);
  });

  it("fixes nitrogen to ammonia in the Haber shape", () => {
    expect(balanced("N2", "H2").coefficients).toEqual([1, 3, 2]);
    expect(dGrxn("N2", "H2")).toBeCloseTo(-32.9, 1);
  });

  it("matches a compound reactant through its canonical spelling", () => {
    // SO2 is canonicalised to O2S internally; the entry must still be found, or
    // the contact process would silently vanish.
    const result = balanced("SO2", "O2");
    expect(result.coefficients).toEqual([2, 1, 2]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["SO3(g)"]);
    expect(dGrxn("SO2", "O2")).toBeCloseTo(-141.62, 2);
  });

  it("slakes lime and fixes it back", () => {
    expect(dGrxn("CaO", "H2O")).toBeCloseTo(-57.94, 2);
    expect(dGrxn("CaO", "CO2")).toBeCloseTo(-131.01, 2);
  });

  it("reads the other metal oxides", () => {
    expect(balanced("Cu", "O2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("Cu", "O2")).toBeCloseTo(-259.4, 1);
    expect(balanced("Al", "O2").coefficients).toEqual([4, 3, 2]);
    expect(dGrxn("Al", "O2")).toBeCloseTo(-3164.6, 1);
  });
});

describe("the table's honest noes", () => {
  it("refuses the plan's negative: N2 + O2 does not combine here", () => {
    expect(declined("N2", "O2")[0]!.reason).toContain("endothermic");
    expect(declined("N2", "O2")[0]!.reason).toContain("deliberately omitted");
  });

  it("refuses iron because its oxide is ambiguous", () => {
    expect(declined("Fe", "O2")[0]!.reason).toContain("Fe2O3 and Fe3O4");
    expect(declined("Fe", "O2")[0]!.reason).toContain("does not guess");
  });

  it("tells every other pair the curated table has no entry — never silence", () => {
    expect(declined("Mg", "N2")[0]!.reason).toBe("the curated combination table has no entry for Mg + N2");
    expect(declined("Fe", "S")[0]!.reason).toContain("no entry");
  });
});

describe("what it cannot price, it says so", () => {
  it("proposes HCl(g) and names the missing ΔGf°", () => {
    const result = balanced("H2", "Cl2");
    expect(result.equation.products[0]!.formula).toBe("HCl");
    const gibbs = reactionGibbs(result);
    expect(gibbs.known).toBe(false);
    expect(gibbs.missing.map((m) => m.reason).join(" ")).toContain("HCl");
  });

  it("proposes the white smoke test even though HCl(g) is unpriced", () => {
    const result = balanced("NH3", "HCl");
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["NH4Cl(s)"]);
    expect(reactionGibbs(result).known).toBe(false);
  });
});