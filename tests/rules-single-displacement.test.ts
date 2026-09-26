/**
 * Single displacement, checked against the reactions the rule is for.
 *
 * The plan's positives are pinned to numbers: Zn + CuSO₄ at −212.55, Fe + CuSO₄
 * at −144.39, Zn + HCl at −147.06 (the value T4 pinned for the same reaction),
 * and the negatives are as important: Cu + ZnSO₄, Cu + HCl, and the self-case
 * must all come back as declines that carry the reason.
 *
 * The suite deliberately includes the cases that would expose a wrong ion
 * charge, because that table is the part of this rule most likely to rot: Cu + 
 * AgNO₃ has to make Cu(NO₃)₂ (the cupric, not cuprous, product), Al + CuSO₄ has
 * to balance as 2,3,1,3 across the 3+/2+ boundary, and the charge table is
 * re-derived one salt at a time.
 */
import { describe, expect, it } from "vitest";
import { singleDisplacement, DISPLACEMENT_CHARGE } from "../src/rules/singleDisplacement.ts";
import { buildSalt, ionFromFormula } from "../src/rules/ions.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { balanceEquation, type BalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";
import { thermoEntry } from "../src/thermo/table.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!singleDisplacement.applies(ctx)) return [];
  return singleDisplacement.propose(ctx).proposals;
}

function declined(...tokens: string[]) {
  return singleDisplacement.propose(context(...tokens)).declined;
}

function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one displacement of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("the gate", () => {
  it("opens for any metal, on or off the series", () => {
    // The gate is deliberately wider than the series itself: tungsten is a metal
    // too, and its input has to reach `propose` so the card can say the series
    // has no word for it rather than the engine shrugging.
    expect(singleDisplacement.applies(context("Zn", "CuSO4"))).toBe(true);
    expect(singleDisplacement.applies(context("Zn"))).toBe(true);
    expect(singleDisplacement.applies(context("W", "CuSO4"))).toBe(true);
  });

  it("shuts for anything with no metal in sight", () => {
    for (const input of [["CuSO4"], ["HCl"], ["CH4", "O2"], ["H2O"], ["NaCl", "NaOH"], ["S"]]) {
      expect(singleDisplacement.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("metal displacing a metal out of a salt", () => {
  it("has zinc pull copper out of copper sulfate, at the pinned value", () => {
    const result = balanced("Zn", "CuSO4");
    expect(result.equation.reactants.map((t) => `${t.formula}(${t.state})`)).toEqual([
      "Zn(s)", "CuSO4(aq)",
    ]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual([
      "ZnSO4(aq)", "Cu(s)",
    ]);
    expect(result.coefficients).toEqual([1, 1, 1, 1]);
    expect(dGrxn("Zn", "CuSO4")).toBeCloseTo(-212.55, 2);
  });

  it("has iron do the same copper displacement, at its own value", () => {
    expect(dGrxn("Fe", "CuSO4")).toBeCloseTo(-144.39, 2);
  });

  it("makes the copper cupric when it displaces silver", () => {
    // Cu + AgNO3 -> Cu(NO3)2 + 2Ag: the one reaction that would expose a too-clever
    // charge table. Building cuprous CuNO3 would also balance, so the formula is
    // checked directly.
    const result = balanced("Cu", "AgNO3");
    expect(result.coefficients).toEqual([1, 2, 1, 2]);
    expect(result.equation.products[0]!.formula).toBe("Cu(NO3)2");
    expect(dGrxn("Cu", "AgNO3")).toBeCloseTo(-88.73, 2);
  });

  it("crosses the 3+/2+ boundary", () => {
    expect(balanced("Al", "CuSO4").coefficients).toEqual([2, 3, 1, 3]);
    expect(dGrxn("Al", "CuSO4")).toBeCloseTo(-1163.87, 1);
  });

  it("lets the solubility rules decide the new salt's phase", () => {
    // PbSO4 is on T6's insoluble list, so the productame (s): the same table
    // neutralisation and double displacement use.
    const result = balanced("Pb", "CuSO4");
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual([
      "PbSO4(s)", "Cu(s)",
    ]);
    expect(dGrxn("Pb", "CuSO4")).toBeCloseTo(-133.86, 2);
  });

  it("names the decision and the products on the reasoning line", () => {
    expect(proposals("Zn", "CuSO4")[0]!.reasoning).toBe(
      "Zn is above Cu in the reactivity series, so it displaces it — the products are ZnSO4 and Cu",
    );
  });

  it("flags that an alkali metal would also eat the water", () => {
    const reasoning = proposals("Na", "CuSO4")[0]!.reasoning;
    expect(reasoning).toContain("alkali metal also reacts with the water itself");
    expect(proposals("K", "AgNO3")[0]!.reasoning).toContain("water itself");
  });
});

describe("metal displacing hydrogen out of an acid", () => {
  it("has zinc release H2 from hydrochloric acid, at the pinned value", () => {
    const result = balanced("Zn", "HCl");
    expect(result.coefficients).toEqual([1, 2, 1, 1]);
    expect(result.equation.products.map((t) => t.state)).toEqual(["aq", "g"]);
    expect(dGrxn("Zn", "HCl")).toBeCloseTo(-147.06, 2);
  });

  it("handles a diprotic acid with the same shape", () => {
    expect(balanced("Zn", "H2SO4").coefficients).toEqual([1, 1, 1, 1]);
    expect(dGrxn("Zn", "H2SO4")).toBeCloseTo(-147.06, 2);
  });

  it("writes tin(II), not tin(IV), for the stannous salt", () => {
    const result = balanced("Sn", "HCl");
    expect(result.equation.products[0]!.formula).toBe("SnCl2");
  });
});

describe("what it declines", () => {
  it("refuses a metal below the salt's cation, with the reason", () => {
    const answer = declined("Cu", "ZnSO4");
    expect(answer.map((d) => d.reason).join(" ")).toBe(
      "Cu sits below Zn in the reactivity series, so it cannot displace it",
    );
    expect(declined("Ag", "CuSO4")[0]!.reason).toContain("below Cu");
    expect(declined("Fe", "ZnSO4")[0]!.reason).toContain("below Zn");
    expect(declined("Zn", "NaCl")[0]!.reason).toContain("below Na");
  });

  it("refuses a metal below hydrogen for the acid case", () => {
    expect(declined("Cu", "HCl")[0]!.reason).toContain("below hydrogen");
  });

  it("refuses to displace a metal from itself", () => {
    expect(declined("Zn", "ZnSO4")[0]!.reason).toBe("Zn cannot displace itself");
  });

  it("says ammonium has no place on the series", () => {
    expect(declined("Zn", "NH4Cl")[0]!.reason).toContain("NH4 is not on the reactivity series");
  });

  it("tells a metal with no series position it cannot be judged", () => {
    expect(declined("W", "CuSO4")[0]!.reason).toBe(
      "W has no place in the reactivity series, so whether it displaces anything from the salt CuSO4 cannot be judged",
    );
    expect(declined("Pt", "HCl")[0]!.reason).toContain("from the acid HCl");
  });

  it("says a lone metal has nothing to displace out of", () => {
    expect(declined("Zn")).toEqual([
      {
        subject: "Zn",
        reason: "single displacement needs a salt, an acid or water for Zn to pull a metal or hydrogen out of, and none was given",
      },
    ]);
  });

  it("does not offer a base as a displacement partner", () => {
    // NaOH splits into Na⁺ + OH⁻, so a splittable-only check would have had the
    // series talking about a hydroxide; the rule keeps to salts and acids.
    expect(declined("Zn", "NaOH")[0]!.reason).toContain("needs a salt, an acid or water");
  });

  it("admits when an acid's anion is unknown, only after the series says yes", () => {
    // For copper the series answer is enough; for a metal above hydrogen the
    // unknown anion is the real gap and has to be named.
    expect(declined("Cu", "H3BO3")[0]!.reason).toContain("below hydrogen");
    expect(declined("Zn", "H3BO3")[0]!.reason).toContain("no anion is known for H3BO3");
  });
});

describe("metal displacing hydrogen out of water", () => {
  it("lets sodium take H2 from cold water, at its value over the balanced equation", () => {
    const result = balanced("Na", "H2O");
    expect(result.coefficients).toEqual([2, 2, 2, 1]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual([
      "NaOH(aq)", "H2(g)",
    ]);
    expect(dGrxn("Na", "H2O")).toBeCloseTo(-364.02, 2);
  });

  it("writes calcium's hydroxide as the precipitate the solubility rules say it is", () => {
    const result = balanced("Ca", "H2O");
    expect(result.coefficients).toEqual([1, 2, 1, 1]);
    expect(result.equation.products[0]!.formula).toBe("Ca(OH)2");
    expect(result.equation.products[0]!.state).toBe("s");
  });

  it("tells an above-hydrogen metal it needs steam instead", () => {
    expect(declined("Mg", "H2O")[0]!.reason).toContain("needs steam, which this rule does not write");
    expect(declined("Zn", "H2O")[0]!.reason).toContain("needs steam");
  });

  it("refuses a below-hydrogen metal out of water the same way it refuses an acid", () => {
    expect(declined("Cu", "H2O")[0]!.reason).toContain("sits below hydrogen");
  });

  it("has no word for an off-series metal in water either", () => {
    expect(declined("W", "H2O")[0]!.reason).toContain("no place in the reactivity series");
  });
});

describe("the charge table cannot rot", () => {
  it("builds the salt a textbook would for every series metal", () => {
    // The products assignment: the exact formulas the charge table implies for
    // the sulfate and chloride of every metal on the series.
    const sulfate: ReadonlyMap<string, string> = new Map([
      ["K", "K2SO4"], ["Na", "Na2SO4"], ["Li", "Li2SO4"], ["Ca", "CaSO4"],
      ["Mg", "MgSO4"], ["Al", "Al2(SO4)3"], ["Zn", "ZnSO4"], ["Fe", "FeSO4"],
      ["Sn", "SnSO4"], ["Pb", "PbSO4"], ["Cu", "CuSO4"], ["Hg", "HgSO4"],
      ["Ag", "Ag2SO4"], ["Au", "Au2(SO4)3"],
    ]);
    const sulfateIon = ionFromFormula("SO4^2-")!;
    for (const [metal, expected] of sulfate) {
      const ion = ionFromFormula(`${metal}^${DISPLACEMENT_CHARGE.get(metal)}+`)!;
      expect(buildSalt(ion, sulfateIon), metal).toBe(expected);
    }
  });

  it("lands every known salt on the same ΔGf° the thermo table holds", () => {
    // The machine cross-check: where the table already knows the salt the charge
    // implies, the built formula must be exactly that species, and it must
    // resolve. This is the check that would catch a charge table drifting away
    // from the data layer it feeds.
    const known: ReadonlyArray<[string, string, string]> = [
      ["Zn^2+", "SO4^2-", "ZnSO4"],
      ["Fe^2+", "SO4^2-", "FeSO4"],
      ["Cu^2+", "SO4^2-", "CuSO4"],
      ["Pb^2+", "SO4^2-", "PbSO4"],
      ["Ag+", "NO3-", "AgNO3"],
      ["Ca^2+", "NO3-", "Ca(NO3)2"],
      ["Na+", "Cl-", "NaCl"],
      ["K+", "Cl-", "KCl"],
    ];
    for (const [cation, anion, salt] of known) {
      const built = buildSalt(ionFromFormula(cation)!, ionFromFormula(anion)!);
      expect(built, salt).toBe(salt);
      expect(thermoEntry(built), `${built} should already be in the thermo table`).toBeDefined();
    }
  });
});