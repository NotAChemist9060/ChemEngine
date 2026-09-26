/**
 * Combination, checked against the curated table of compound-involving joins.
 *
 * Element + element now belongs to the simple-materials table, so this suite
 * covers the reactions where at least one reactant is a compound: carbon
 * monoxide burning on (−514.40), the contact process (−141.62), slaking lime
 * (−57.94), fixing lime back to limestone (−131.01, the mirror of
 * decomposition's +131.01). The noes that used to live here (N₂ + O₂, Fe + O₂)
 * moved with the element rows, and the element + element pairs are skipped
 * outright so the two tables never collide.
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
    expect(combination.applies(context("CO", "O2"))).toBe(true);
    expect(combination.applies(context("CaO", "H2O"))).toBe(true);
    expect(combination.applies(context("NH3", "HCl"))).toBe(true);
  });

  it("stays quiet for a single species — decomposition's question", () => {
    for (const input of [["Mg"], ["CH4"], ["H2O"]]) {
      expect(combination.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("a compound joins another substance", () => {
  it("burns carbon monoxide on to carbon dioxide", () => {
    expect(balanced("CO", "O2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("CO", "O2")).toBeCloseTo(-514.4, 2);
  });

  it("runs the contact process", () => {
    const result = balanced("SO2", "O2");
    expect(result.coefficients).toEqual([2, 1, 2]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["SO3(g)"]);
    expect(dGrxn("SO2", "O2")).toBeCloseTo(-141.62, 2);
  });

  it("matches a compound reactant through its canonical spelling", () => {
    // SO2 is canonicalised to O2S internally; the entry must still be found, or
    // the contact process would silently vanish.
    expect(proposals("SO2", "O2")).toHaveLength(1);
  });

  it("slakes lime and fixes it back", () => {
    expect(dGrxn("CaO", "H2O")).toBeCloseTo(-57.94, 2);
    expect(dGrxn("CaO", "CO2")).toBeCloseTo(-131.01, 2);
  });

  it("proposes the brown gas test even though NO is unpriced", () => {
    const result = balanced("NO", "O2");
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["NO2(g)"]);
    expect(reactionGibbs(result).known).toBe(false);
  });
});

describe("element + element is left to simple materials", () => {
  it("says nothing at all for a pair of simple substances", () => {
    const verdict = combination.propose(context("Mg", "O2"));
    expect(verdict.proposals).toEqual([]);
    expect(verdict.declined).toEqual([]);
  });
});

describe("the table's honest noes", () => {
  it("tells every unmatched pair the curated table has no entry — never silence", () => {
    expect(declined("CaO", "N2")[0]!.reason).toBe("the curated combination table has no entry for CaO + N2");
    expect(declined("CO2", "H2O")[0]!.reason).toContain("no entry");
  });
});

describe("what it cannot price, it says so", () => {
  it("proposes the white smoke test even though HCl(g) is unpriced", () => {
    const result = balanced("NH3", "HCl");
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["NH4Cl(s)"]);
    expect(reactionGibbs(result).known).toBe(false);
  });
});
