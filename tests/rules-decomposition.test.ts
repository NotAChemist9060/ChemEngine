/**
 * Decomposition, checked against the curated table.
 *
 * The star is the one T4 pinned for M4: CaCO₃ → CaO + CO₂ reads +131.01 — the
 * positive value that says it needs a kiln (never run downhill on its own).
 * Its reverse, CaO + CO₂ in combination, reads the same number flipped
 * (−131.01), which is a good sanity check on the shared ΔGf° values. Water's
 * electrolysis and the Down's cell go the same way: honest positives that say
 * "only with an electric current". NH₄Cl is the table's one unpriced entry —
 * the table holds only HCl(aq), so its ΔG is declared unknown, never guessed.
 */
import { describe, expect, it } from "vitest";
import { decomposition } from "../src/rules/decomposition.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { balanceEquation, type BalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!decomposition.applies(ctx)) return [];
  return decomposition.propose(ctx).proposals;
}

function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one decomposition of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("the gate", () => {
  it("opens for a single species", () => {
    expect(decomposition.applies(context("CaCO3"))).toBe(true);
    expect(decomposition.applies(context("H2O"))).toBe(true);
  });

  it("stays quiet when several species are named — the other rules get to speak", () => {
    for (const input of [["CaCO3", "NaCl"], ["CaO", "CO2"], ["Na", "Cl2"]]) {
      expect(decomposition.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("the table's decompositions", () => {
  it("heats calcium carbonate, at the pinned +131.01", () => {
    const result = balanced("CaCO3");
    expect(result.coefficients).toEqual([1, 1, 1]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["CaO(s)", "CO2(g)"]);
    expect(dGrxn("CaCO3")).toBeCloseTo(131.01, 2);
    expect(proposals("CaCO3")[0]!.reasoning).toContain("breaks apart");
    expect(proposals("CaCO3")[0]!.reasoning).toContain("heating");
  });

  it("drives steam off slaked lime", () => {
    const result = balanced("Ca(OH)2");
    expect(result.coefficients).toEqual([1, 1, 1]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["CaO(s)", "H2O(g)"]);
    expect(dGrxn("Ca(OH)2")).toBeCloseTo(66.5, 2);
  });

  it("splits water only with an electric current — honestly positive", () => {
    const result = balanced("H2O");
    expect(result.coefficients).toEqual([2, 2, 1]);
    expect(dGrxn("H2O")).toBeCloseTo(474.26, 2);
  });

  it("lets hydrogen peroxide fall apart on its own — the one fast one", () => {
    const result = balanced("H2O2");
    expect(result.coefficients).toEqual([2, 2, 1]);
    expect(dGrxn("H2O2")).toBeCloseTo(-233.46, 2);
  });

  it("runs the Downs cell on molten salt", () => {
    const result = balanced("NaCl");
    expect(result.coefficients).toEqual([2, 2, 1]);
    expect(dGrxn("NaCl")).toBeCloseTo(768.28, 2);
  });

  it("strips molten magnesium oxide by electrolysis", () => {
    const result = balanced("MgO");
    expect(result.coefficients).toEqual([2, 2, 1]);
    expect(dGrxn("MgO")).toBeCloseTo(1138.6, 2);
  });

  it("typed phases win over the table's", () => {
    // NaCl(aq) is in the table with its own ΔGf°, so asking for it changes the price.
    const result = balanced("NaCl(aq)");
    expect(result.equation.reactants.map((t) => `${t.formula}(${t.state})`)).toEqual(["NaCl(aq)"]);
    expect(dGrxn("NaCl(aq)")).toBeCloseTo(786.26, 2);
  });
});

describe("what it cannot do", () => {
  it("proposes NH4Cl and names the missing ΔGf°", () => {
    const result = balanced("NH4Cl");
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["NH3(g)", "HCl(g)"]);
    const gibbs = reactionGibbs(result);
    expect(gibbs.known).toBe(false);
    expect(gibbs.missing.map((m) => m.reason).join(" ")).toContain("HCl");
  });

  it("tells a species with no entry the curated table has no decomposition for it", () => {
    expect(decomposition.propose(context("CO2")).declined[0]!.reason).toBe(
      "no decomposition in the curated table for CO2",
    );
    expect(decomposition.propose(context("CuSO4")).declined[0]!.reason).toContain("no decomposition");
  });
});