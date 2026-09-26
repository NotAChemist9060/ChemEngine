/**
 * ΔG_rxn° = Σ n·ΔGf°(products) − Σ n·ΔGf°(reactants), and the values here are
 * pinned to the numbers a textbook prints, so a slip in `data/thermo.json`
 * cannot hide behind a tolerance.
 *
 * The pinned figures come from the table itself, cross-checked against the
 * standard references during M4 T3: methane combustion at −817.9 kJ/mol with
 * liquid water, the same reaction at −800.8 with water vapour, carbon
 * oxidation at −394.4, the strong-acid neutralisation at −79.9 (the familiar
 * H+ + OH− → H2O value), and the two precipitation reactions at −55.7 and
 * −56.8, which independently reproduce −RT·ln(1/Ksp) for AgCl (1.8e-10) and
 * BaSO4 (1.1e-10). The calcium carbonate figure is +131.0, against the +131.1
 * quoted in the plan text, so it is asserted with a tolerance rather than
 * exactly.
 */
import { describe, expect, it } from "vitest";
import { balanceEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs, type ReactionGibbs } from "../src/thermo/thermo.ts";
import { THERMO_TEMPERATURE } from "../src/thermo/table.ts";
import { ratToString } from "../src/util/rational.ts";

/** Parse, balance, assess — the pipeline `chem feasibility` will run. */
function gibbs(input: string): ReactionGibbs {
  return reactionGibbs(balanceEquation(parseEquation(input)));
}

/** The total, for the known cases. Fails the test if the sum was unknown. */
function totalKj(input: string): number {
  const result = gibbs(input);
  expect(result.known, `${input}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("reaction Gibbs energy", () => {
  it("computes methane combustion at the accepted value", () => {
    // CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l), ΔGf°: -50.72, 0, -394.36, -237.13
    expect(totalKj("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)")).toBeCloseTo(-817.9, 2);
  });

  it("moves by 2 × 8.56 kJ/mol when the water comes out as vapour", () => {
    // The whole reason phases are first-class: -228.57 against -237.13 for the
    // liquid, twice over. Letting the water out as vapour makes the reaction
    // 17.12 kJ/mol *less* favourable.
    const liquid = totalKj("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)");
    const vapour = totalKj("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(g)");
    expect(vapour).toBeCloseTo(-800.8, 1);
    expect(vapour - liquid).toBeCloseTo(2 * 8.56, 2);
  });

  it("reads the element reference states as zero", () => {
    // O2 in its standard state is 0, so carbon oxidation is CO2's own value.
    expect(totalKj("C(s) + O2(g) -> CO2(g)")).toBeCloseTo(-394.4, 1);
    // A species on both sides cancels exactly, not approximately.
    expect(totalKj("C(s) -> C(s)")).toBe(0);
  });

  it("reports the total for the balanced equation, as written out", () => {
    // A fractional coefficient is scaled to smallest integers by the balancer,
    // so half a mole of water reads as twice its per-mole value. The number is
    // only meaningful next to the balanced equation, which the caller prints.
    const result = gibbs("1/2H2(g) + 1/2O2(g) -> H2O(l)");
    expect(result.known).toBe(true);
    expect(result.dGrxnKj).toBeCloseTo(-474.26, 2);
    const terms = result.terms.map((t) => `${t.coefficient} ${t.formula}`);
    expect(terms).toEqual(["2 H2", "1 O2", "2 H2O"]);
  });

  it("accepts a reversible equation and reports the forward direction", () => {
    expect(totalKj("C(s) + O2(g) <=> CO2(g)")).toBeCloseTo(-394.4, 1);
  });

  it("is exact where floating point would drift", () => {
    // BaCl2 + Na2SO4 -> BaSO4 + 2NaCl. Summing the doubles in the obvious
    // order gives -56.809999999999945; the rational total is -5681/100.
    const result = gibbs("BaCl2(aq) + Na2SO4(aq) -> BaSO4(s) + 2NaCl(aq)");
    expect(result.known).toBe(true);
    expect(ratToString(result.dGrxn!)).toBe("-5681/100");
    expect(result.dGrxnKj).toBeCloseTo(-56.81, 2);
    const naive = -1362.2 + 2 * -393.13 - (-823.22 + -1268.43);
    expect(naive).not.toBe(-56.81);
  });

  it("stamps the temperature its values are valid at", () => {
    expect(gibbs("C(s) + O2(g) -> CO2(g)").temperature).toBe(THERMO_TEMPERATURE);
    expect(THERMO_TEMPERATURE).toBe(298.15);
  });
});

describe("reactions the plan pins", () => {
  it("calcium carbonate decomposition is uphill", () => {
    // CaCO3 -> CaO + CO2, ΔGf°: -1128.79, -603.42, -394.36
    expect(totalKj("CaCO3(s) -> CaO(s) + CO2(g)")).toBeCloseTo(131.0, 1);
  });

  it("strong acid plus strong base is -79.9, and scaling it stays exact", () => {
    expect(totalKj("HCl(aq) + NaOH(aq) -> NaCl(aq) + H2O(l)")).toBeCloseTo(-79.9, 1);
    // Two equivalents is exactly twice the figure, because both neutralise
    // H+ + OH- -> H2O and the extra SO4^2- cancels on both sides.
    expect(totalKj("H2SO4(aq) + 2NaOH(aq) -> Na2SO4(aq) + 2H2O(l)")).toBeCloseTo(2 * -79.89, 2);
  });

  it("a weak acid neutralises less exergically than a strong one", () => {
    // Not a pinned number so much as a physical check: the acetate ion's
    // stability is already counted in its ΔGf°, so CH3COOH + OH- gives back
    // less than the -79.9 of the strong-acid case.
    const weak = totalKj("CH3COOH(aq) + NaOH(aq) -> CH3COONa(aq) + H2O(l)");
    expect(weak).toBeCloseTo(-52.8, 1);
    expect(weak).toBeGreaterThan(-79.9);
  });

  it("precipitation matches -RT·ln(1/Ksp)", () => {
    // AgCl, Ksp = 1.8e-10 -> -55.6 kJ/mol; BaSO4, Ksp = 1.1e-10 -> -56.6.
    expect(totalKj("AgNO3(aq) + NaCl(aq) -> AgCl(s) + NaNO3(aq)")).toBeCloseTo(-55.7, 1);
    expect(totalKj("BaCl2(aq) + Na2SO4(aq) -> BaSO4(s) + 2NaCl(aq)")).toBeCloseTo(-56.8, 1);
  });

  it("zinc displaces hydrogen from hydrochloric acid", () => {
    // Zn(s) + 2HCl(aq) -> ZnCl2(aq) + H2(g), ΔGf°: 0, -131.23, -409.52, 0
    expect(totalKj("Zn(s) + 2HCl(aq) -> ZnCl2(aq) + H2(g)")).toBeCloseTo(-147.1, 1);
  });
});

describe("terms", () => {
  it("carries the sign, coefficient and contribution of every species", () => {
    const result = gibbs("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)");
    expect(
      result.terms.map((t) => [t.formula, t.sign, t.coefficient, t.contributionKj]),
    ).toEqual([
      ["CH4", -1, 1, 50.72],
      ["O2", -1, 2, 0],
      ["CO2", 1, 1, -394.36],
      ["H2O", 1, 2, -474.26],
    ]);
    // A reactant's contribution is the negation of its formation energy, which
    // is what makes the sum read the way the formula does.
    expect(result.terms[0]!.contributionKj).toBe(-result.terms[0]!.dGfKj!);
  });

  it("echoes the phase the equation named", () => {
    const result = gibbs("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)");
    expect(result.terms.map((t) => t.state)).toEqual(["g", "g", "g", "l"]);
  });

  it("fills in a phase the table can decide on its own", () => {
    // CaCO3 has only one phase, so an equation that names none still resolves.
    const result = gibbs("CaCO3 -> CaO + CO2");
    expect(result.known).toBe(true);
    expect(result.terms.map((t) => t.state)).toEqual(["s", "s", "g"]);
  });
});

describe("what it refuses to answer", () => {
  it("will not total a reaction with a species the table lacks", () => {
    const result = gibbs("C6H12O6(s) + 6O2(g) -> 6CO2(g) + 6H2O(l)");
    expect(result.known).toBe(false);
    // No total at all: a hole in the sum is not a zero in the sum.
    expect(result.dGrxnKj).toBeUndefined();
    expect(result.dGrxn).toBeUndefined();
    expect(result.missing).toEqual([
      { formula: "C6H12O6", state: "s", reason: "no ΔGf° entry for 'C6H12O6'" },
    ]);
  });

  it("names the species that blocked it on the term as well", () => {
    const result = gibbs("C6H12O6(s) + 6O2(g) -> 6CO2(g) + 6H2O(l)");
    const glucose = result.terms.find((t) => t.formula === "C6H12O6")!;
    expect(glucose.dGfKj).toBeUndefined();
    expect(glucose.contributionKj).toBeUndefined();
    expect(glucose.reason).toBe("no ΔGf° entry for 'C6H12O6'");
    // The species that do have values still report theirs, so the partial
    // work is visible rather than thrown away.
    expect(result.terms.find((t) => t.formula === "CO2")!.dGfKj).toBe(-394.36);
  });

  it("asks which phase rather than picking one", () => {
    // Water has three phases and the equation named none; 8.6 kJ/mol rides on
    // the difference, so an assumed phase would be a confident wrong answer.
    const result = gibbs("CH4(g) + 2O2(g) -> CO2(g) + 2H2O");
    expect(result.known).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]!.formula).toBe("H2O");
    expect(result.missing[0]!.state).toBeUndefined();
    expect(result.missing[0]!.reason).toBe("H2O has more than one phase (l, g, aq) — say which one");
  });

  it("reports a phase the species does not have in that form", () => {
    const result = gibbs("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(s)");
    expect(result.known).toBe(false);
    expect(result.missing[0]!.state).toBe("s");
    expect(result.missing[0]!.reason).toContain("no ΔGf° for H2O(s)");
  });
});
