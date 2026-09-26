/**
 * Double displacement, checked against the reactions the rule is for.
 *
 * The plan's positives are pinned to numbers: AgNO₃ + NaCl at −55.67 and
 * BaCl₂ + Na₂SO₄ at −56.81 (both among the values T4 pinned for M4), plus the
 * carbonate swap Na₂CO₃ + CaCl₂ → CaCO₃(s) + 2NaCl, which exists only because
 * the carbonates were left to the classifier to call salts. The plan's negative
 * is NaCl + KNO₃, and it must come back as a decline that names the dissolved
 * products — with no precipitate, nothing drives the reaction.
 *
 * The suite also pins the honest edges: a product the solubility rules cannot
 * judge is a "cannot judge", never a "no reaction"; a solid reactant cannot
 * meet its partner in solution; a two-cation salt like KAl(SO₄)₂ has no single
 * swap to write; and two salts that share an ion hand back what they started
 * with.
 */
import { describe, expect, it } from "vitest";
import { doubleDisplacement } from "../src/rules/doubleDisplacement.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { balanceEquation, type BalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!doubleDisplacement.applies(ctx)) return [];
  return doubleDisplacement.propose(ctx).proposals;
}

function declined(...tokens: string[]) {
  return doubleDisplacement.propose(context(...tokens)).declined;
}

function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one swap of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("the gate", () => {
  it("opens for any salt", () => {
    expect(doubleDisplacement.applies(context("NaCl"))).toBe(true);
    expect(doubleDisplacement.applies(context("AgNO3", "NaCl"))).toBe(true);
    expect(doubleDisplacement.applies(context("KAl(SO4)2", "NaCl"))).toBe(true);
  });

  it("shuts for acids, bases, metals and fuels", () => {
    // HCl + NaOH is neutralisation's job; the other shapes have no salt at all.
    for (const input of [["HCl", "NaOH"], ["CH4", "O2"], ["Zn"], ["Cu", "HCl"], ["H2O"]]) {
      expect(doubleDisplacement.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("the precipitate-driven swaps", () => {
  it("has silver chloride fall out of the mix of silver nitrate and salt, at the pinned value", () => {
    const result = balanced("AgNO3", "NaCl");
    expect(result.coefficients).toEqual([1, 1, 1, 1]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual([
      "AgCl(s)", "NaNO3(aq)",
    ]);
    expect(dGrxn("AgNO3", "NaCl")).toBeCloseTo(-55.67, 2);
  });

  it("has barium sulfate drive the swap with sodium sulfate, at its pinned value", () => {
    const result = balanced("BaCl2", "Na2SO4");
    expect(result.coefficients).toEqual([1, 1, 1, 2]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual([
      "BaSO4(s)", "NaCl(aq)",
    ]);
    expect(dGrxn("BaCl2", "Na2SO4")).toBeCloseTo(-56.81, 2);
  });

  it("runs a carbonate through the swap — the classifier calls Na2CO3 a salt, so it works", () => {
    const result = balanced("Na2CO3", "CaCl2");
    expect(result.coefficients).toEqual([1, 1, 1, 2]);
    // The precipitate leads the products, whatever order the ions were swapped in.
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)[0]).toBe("CaCO3(s)");
    expect(dGrxn("Na2CO3", "CaCl2")).toBeCloseTo(-47.44, 2);
  });

  it("writes lead sulfate out of lead nitrate and sodium sulfate", () => {
    const result = balanced("Pb(NO3)2", "Na2SO4");
    expect(result.coefficients).toEqual([1, 1, 1, 2]);
    expect(dGrxn("Pb(NO3)2", "Na2SO4")).toBeCloseTo(-43.97, 2);
  });

  it("names the swap and the driver on the reasoning line", () => {
    expect(proposals("AgNO3", "NaCl")[0]!.reasoning).toBe(
      "the ions swap — Ag pairs with Cl, and Na with NO3 — AgCl is insoluble, so it falls out of solution and drives the reaction",
    );
  });

  it("keeps a polyatomic partner and says the salt cloud be priced", () => {
    // NH4Cl + AgNO3 → AgCl(s) + NH4NO3: the precipitate is right, but NH4NO3 has
    // no ΔGf° entry — the proposal stands and the unknown is named, not hidden.
    const result = balanced("NH4Cl", "AgNO3");
    expect(result.equation.products[0]!.formula).toBe("AgCl");
    const gibbs = reactionGibbs(result);
    expect(gibbs.known).toBe(false);
    expect(gibbs.missing.map((m) => m.reason).join(" ")).toContain("NH4NO3");
  });
});

describe("what it declines", () => {
  it("refuses the plan's negative: both swapped products stay dissolved", () => {
    const reasons = declined("NaCl", "KNO3").map((d) => d.reason).join(" ");
    expect(reasons).toContain("swap makes NaNO3(aq) and KCl(aq)");
    expect(reasons).toContain("nothing drives a reaction");
    expect(declined("CuSO4", "NaCl")[0]!.reason).toContain("stay dissolved");
  });

  it("says two salts that share an ion hand back what they started with", () => {
    expect(declined("AgNO3", "NaNO3")[0]!.reason).toContain("share an ion");
    expect(declined("NaCl", "NaCl")[0]!.reason).toContain("share an ion");
  });

  it("refuses a solid reactant that cannot meet its partner in solution", () => {
    expect(declined("AgCl", "NaNO3")[0]!.reason).toContain(
      "AgCl does not dissolve on the solubility rules — it cannot meet NaNO3 in solution",
    );
    expect(declined("CaCO3", "NaCl")[0]!.reason).toContain("CaCO3 does not dissolve");
  });

  it("names the missing precipitate knowledge instead of claiming no reaction", () => {
    // KMnO4 + AgNO3 would make AgMnO4, and the solubility rules have no verdict
    // for it — the decline says the rules cannot judge, never that it is safe.
    const reason = declined("KMnO4", "AgNO3")[0]!.reason;
    expect(reason).toContain("cannot judge AgMnO4");
    expect(reason).toContain("more than one kind of cation (Ag, Mn)");
  });

  it("has no single swap for a two-cation salt", () => {
    const answer = declined("KAl(SO4)2", "NaCl");
    expect(answer.map((d) => d.reason).join(" ")).toContain(
      "splits KAl(SO4)2 into more than one cation kind (K, Al)",
    );
  });

  it("says a lone salt has nobody to swap with", () => {
    expect(declined("NaCl")).toEqual([
      {
        subject: "NaCl",
        reason: "double displacement needs a second salt to swap ions with NaCl, and none was given",
      },
    ]);
  });
});