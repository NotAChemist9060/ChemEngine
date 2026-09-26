import { describe, expect, it } from "vitest";
import { redox } from "../src/rules/redox.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { balanceEquation, type BalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!redox.applies(ctx)) return [];
  return redox.propose(ctx).proposals;
}

function declined(...tokens: string[]) {
  return redox.propose(context(...tokens)).declined;
}

function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one redox reaction of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("the gate", () => {
  it("opens for any pair", () => {
    expect(redox.applies(context("CuO", "H2"))).toBe(true);
    expect(redox.applies(context("Cl2", "NaBr"))).toBe(true);
    expect(redox.applies(context("Fe", "H2O"))).toBe(true);
  });
  it("stays quiet for a single species", () => {
    expect(redox.applies(context("CuO"))).toBe(false);
  });
});

describe("metal-oxide reduction", () => {
  it("reduces CuO with H2 at the pinned value", () => {
    const result = balanced("CuO", "H2");
    expect(result.coefficients).toEqual([1, 1, 1, 1]);
    expect(result.equation.reactants.map((t) => `${t.formula}(${t.state})`)).toEqual(["CuO(s)", "H2(g)"]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["Cu(s)", "H2O(l)"]);
    expect(dGrxn("CuO", "H2")).toBeCloseTo(-107.43, 2);
  });
  it("reduces Fe2O3 with CO", () => {
    const result = balanced("Fe2O3", "CO");
    expect(result.coefficients).toEqual([1, 3, 2, 3]);
    expect(dGrxn("Fe2O3", "CO")).toBeCloseTo(-29.40, 1);
  });
  it("reduces CuO with carbon", () => {
    const result = balanced("CuO", "C");
    expect(result.coefficients).toEqual([1, 1, 1, 1]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["Cu(s)", "CO(g)"]);
    expect(dGrxn("CuO", "C")).toBeCloseTo(-7.46, 1);
  });
  it("reduces ZnO with CO", () => {
    expect(dGrxn("ZnO", "CO")).toBeCloseTo(63.30, 1);
  });
  it("refuses the electrolysis-only oxides", () => {
    const out = declined("MgO", "H2");
    expect(out[0]!.reason).toContain("too reactive");
    expect(out[0]!.reason).toContain("electrolysis");
  });
});

describe("halogen displacement", () => {
  it("displaces bromine from sodium bromide with chlorine", () => {
    const result = balanced("Cl2", "NaBr");
    expect(result.coefficients).toEqual([1, 2, 2, 1]);
    expect(result.equation.products[0]!.formula).toBe("NaCl");
    expect(result.equation.products[1]!.formula).toBe("Br2");
  });
  it("refuses the reverse with the order reason", () => {
    const out = declined("I2", "NaCl");
    expect(out.map((d) => d.reason).join(" | ")).toContain("halogen order");
  });
});

describe("metal + steam", () => {
  it("oxidises iron to magnetite at the pinned value", () => {
    const result = balanced("Fe", "H2O");
    expect(result.coefficients).toEqual([3, 4, 1, 4]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["Fe3O4(s)", "H2(g)"]);
    expect(dGrxn("Fe", "H2O")).toBeCloseTo(-101.12, 1);
  });
  it("leaves cold-water metals to single displacement", () => {
    expect(proposals("Na", "H2O")).toEqual([]);
  });
});
