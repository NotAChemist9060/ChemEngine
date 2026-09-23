import { describe, expect, it } from "vitest";
import { parseEquation } from "../src/core/equation.ts";
import { ratToString } from "../src/util/rational.ts";

describe("equation parser", () => {
  it("parses a forward equation with coefficients", () => {
    const eq = parseEquation("2H2 + O2 -> 2H2O");
    expect(eq.reversible).toBe(false);
    expect(eq.reactants.map((t) => t.formula)).toEqual(["H2", "O2"]);
    expect(eq.products.map((t) => t.formula)).toEqual(["H2O"]);
    expect(ratToString(eq.reactants[0]!.coefficient)).toBe("2");
  });

  it("defaults missing coefficients to 1", () => {
    const eq = parseEquation("CH4 + O2 -> CO2 + H2O");
    for (const t of eq.reactants) expect(ratToString(t.coefficient)).toBe("1");
  });

  it("detects reversible equations", () => {
    expect(parseEquation("N2 + 3H2 <=> 2NH3").reversible).toBe(true);
    expect(parseEquation("N2 + 3H2 ⇌ 2NH3").reversible).toBe(true);
  });

  it("accepts = and => as forward arrows", () => {
    expect(parseEquation("H2O = H2 + O2").products.map((t) => t.formula)).toEqual(["H2", "O2"]);
    expect(parseEquation("C + O2 => CO2").reactants[0]!.formula).toBe("C");
  });

  it("strips physical states", () => {
    const eq = parseEquation("NaCl(s) + AgNO3(aq) -> AgCl(s) + NaNO3(aq)");
    expect(eq.reactants[0]!.state).toBe("s");
    expect(eq.reactants[0]!.formula).toBe("NaCl");
    expect(eq.products[1]!.state).toBe("aq");
  });

  it("accepts fractional coefficients", () => {
    const eq = parseEquation("1/2H2 + 1/2O2 -> H2O");
    expect(ratToString(eq.reactants[0]!.coefficient)).toBe("1/2");
  });

  it("rejects equations without an arrow", () => {
    expect(() => parseEquation("H2 + O2")).toThrow(/missing arrow/);
  });

  it("rejects incomplete equations", () => {
    expect(() => parseEquation("H2O ->")).toThrow(/incomplete/);
    expect(() => parseEquation("-> H2O")).toThrow(/incomplete/);
  });

  it("rejects unknown elements", () => {
    expect(() => parseEquation("H2 + X -> H2X")).toThrow(/unknown element symbol/);
  });
});