/**
 * Combustion, checked against the numbers the rule is for.
 *
 * The methane case is the milestone's acceptance value (−817.9 kJ/mol with
 * liquid water) and the benzene and ethanol cases are there to prove the rule is
 * not a one-molecule special case: they go through the same code path and land
 * on their own textbook figures. The water phase is pinned deliberately — the
 * same equations with H2O(g) come out 17.1 kJ/mol higher per mole of water, and
 * a rule that left the phase to the engine could not be trusted to hit either.
 *
 * The declines get as much attention as the proposals, because a rule that
 * silently skips a fuel is the failure mode §3 exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { combustion } from "../src/rules/combustion.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { balanceEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";
import type { BalancedEquation } from "../src/core/balance.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

/** The proposals a rule makes for these species. */
function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!combustion.applies(ctx)) return [];
  return combustion.propose(ctx).proposals;
}

/** The one proposal, balanced, failing the test if there is not exactly one. */
function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one combustion of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

/** ΔG_rxn° of the balanced proposal, failing if the table cannot price it. */
function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("the gate", () => {
  it("opens for something burnable, with or without oxygen", () => {
    // Oxygen is not part of the gate: "CH4" alone has to reach `propose` so the
    // card can say the oxygen is missing, rather than the engine shrugging.
    expect(combustion.applies(context("CH4", "O2"))).toBe(true);
    expect(combustion.applies(context("CH4"))).toBe(true);
    expect(combustion.applies(context("C2H5OH", "O2"))).toBe(true);
  });

  it("shuts for anything with no carbon and hydrogen to burn", () => {
    for (const input of [["NaCl", "O2"], ["H2", "O2"], ["O2"], ["Fe", "O2"], ["CO2", "O2"]]) {
      expect(combustion.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("what it writes", () => {
  it("burns methane to the milestone's acceptance value", () => {
    expect(dGrxn("CH4", "O2")).toBeCloseTo(-817.9, 2);
  });

  it("balances the fuel it was given, whatever the fuel", () => {
    // The rule writes no coefficients at all; the balancer supplies them, so a
    // rule can never be the reason a coefficient is wrong.
    expect(balanced("CH4", "O2").coefficients).toEqual([1, 2, 1, 2]);
    expect(balanced("C2H6", "O2").coefficients).toEqual([2, 7, 4, 6]);
    expect(balanced("C2H2", "O2").coefficients).toEqual([2, 5, 4, 2]);
    expect(balanced("C2H5OH", "O2").coefficients).toEqual([1, 3, 2, 3]);
  });

  it("puts every phase on, with the water liquid", () => {
    const result = balanced("CH4", "O2");
    expect(result.equation.reactants.map((t) => t.state)).toEqual(["g", "g"]);
    expect(result.equation.products.map((t) => t.state)).toEqual(["g", "l"]);
  });

  it("burns benzene, ethanol and ethane to their own textbook figures", () => {
    // Not a special case for methane: three more fuels, same code path.
    expect(dGrxn("C6H6", "O2")).toBeCloseTo(-6404.1, 1);
    expect(dGrxn("C2H5OH", "O2")).toBeCloseTo(-1325.9, 1);
    expect(dGrxn("C2H6", "O2")).toBeCloseTo(-2934.6, 1);
  });

  it("takes the fuel's phase from the table, not from a guess", () => {
    // CH4 is a gas and benzene is a liquid, and the rule did not have to know
    // which: it asked. The written equations show the difference.
    const equations = proposals("CH4", "O2").concat(proposals("C6H6", "O2")).map((p) => p.equation);
    expect(equations).toContain("CH4(g) + O2(g) -> CO2(g) + 2H2O(l)");
    expect(equations).toContain("C6H6(l) + O2(g) -> CO2(g) + 2H2O(l)");
  });

  it("lets a typed phase override the table", () => {
    // A user who writes C6H6(g) means vapour benzene, and the engine has to
    // price what they asked for rather than what it would have chosen.
    const found = proposals("C6H6(g)", "O2");
    expect(found[0]!.equation).toBe("C6H6(g) + O2(g) -> CO2(g) + 2H2O(l)");
  });

  it("keeps the spelling the user typed for the fuel", () => {
    expect(proposals("C2H5OH", "O2")[0]!.equation).toContain("C2H5OH(l)");
  });

  it("names the fuel and what it is on the reasoning line", () => {
    expect(proposals("CH4", "O2")[0]!.reasoning).toBe(
      "methane is a hydrocarbon, and a complete burn in oxygen gives carbon dioxide and liquid water",
    );
    expect(proposals("C2H5OH", "O2")[0]!.reasoning).toContain("ethanol is an alcohol");
    expect(proposals("C6H6", "O2")[0]!.reasoning).toContain("benzene is an aromatic hydrocarbon");
  });

  it("burns every fuel given, not just the first", () => {
    expect(proposals("CH4", "C2H6", "O2")).toHaveLength(2);
  });

  it("ignores a second copy of the oxygen", () => {
    expect(proposals("CH4", "O2", "O2")).toHaveLength(1);
  });
});

describe("what it declines", () => {
  it("says the oxygen is missing", () => {
    const verdict = combustion.propose(context("CH4"));
    expect(verdict.proposals).toEqual([]);
    expect(verdict.declined).toEqual([
      { subject: "CH4", reason: "combustion needs O2, and no oxygen was given" },
    ]);
  });

  it("says which element stopped a fuel that is not C, H and O", () => {
    // Burning these would have to produce HCl or N2 as well, and neither is in
    // the table, so the equation would be missing a product.
    const chlorinated = combustion.propose(context("C6H5Cl", "O2"));
    expect(chlorinated.proposals).toEqual([]);
    expect(chlorinated.declined[0]!.reason).toBe(
      "C6H5Cl contains chlorine, so burning it would make chlorine compounds as well, which this rule does not write",
    );
    const nitrogenous = combustion.propose(context("CH3CN", "O2"));
    expect(nitrogenous.declined[0]!.reason).toContain("nitrogen");
  });

  it("leaves carbon on its own to the combination rule", () => {
    // C + O2 -> CO2 is a combination, and the rule says where it went rather
    // than emitting a combustion of something that is not a fuel.
    expect(combustion.applies(context("C", "O2"))).toBe(false);
  });

  it("says nothing about species that were never fuel-shaped", () => {
    // Water and salt in the list are not declines; they are simply not fuels,
    // and a card full of "NaCl does not burn" would be noise.
    const verdict = combustion.propose(context("CH4", "O2", "NaCl", "H2O"));
    expect(verdict.proposals).toHaveLength(1);
    expect(verdict.declined).toEqual([]);
  });
});

describe("fuels the table has never heard of", () => {
  it("still proposes the reaction, with no phase it cannot justify", () => {
    // Glucose and heptane both burn; the engine has no ΔGf° for them. The
    // reaction is real, so the rule proposes it with the phase left off, and the
    // thermo layer reports the gap — the candidate is ranked last and labelled,
    // which is the arrangement decision 3 in the M4 plan asks for. The rule
    // inventing a phase would be the failure.
    const found = proposals("C6H12O6", "O2");
    expect(found).toHaveLength(1);
    expect(found[0]!.equation).toBe("C6H12O6 + O2(g) -> CO2(g) + 2H2O(l)");
    const result = reactionGibbs(balanceEquation(parseEquation(found[0]!.equation)));
    expect(result.known).toBe(false);
    expect(result.missing.map((m) => m.formula)).toEqual(["C6H12O6"]);
  });

  it("names the fuel by formula when the table has no name for it", () => {
    expect(proposals("C7H16", "O2")[0]!.reasoning).toContain("C7H16 is a hydrocarbon");
  });
});
