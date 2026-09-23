import { describe, expect, it } from "vitest";
import { parseFormula } from "../src/core/formula.ts";

function counts(m: Map<string, number>): Record<string, number> {
  return Object.fromEntries(m);
}

describe("formula parser", () => {
  it("parses simple formulas", () => {
    const h2o = parseFormula("H2O");
    expect(counts(h2o.elements)).toEqual({ H: 2, O: 1 });
    expect(h2o.molarMass).toBeCloseTo(18.015, 3);
  });

  it("parses glucose", () => {
    const g = parseFormula("C6H12O6");
    expect(counts(g.elements)).toEqual({ C: 6, H: 12, O: 6 });
    expect(g.molarMass).toBeCloseTo(180.156, 3);
  });

  it("parses groups and nested groups", () => {
    expect(counts(parseFormula("(NH4)2SO4").elements)).toEqual({ N: 2, H: 8, S: 1, O: 4 });
    expect(counts(parseFormula("Ca(OH)2").elements)).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(counts(parseFormula("Al2(SO4)3").elements)).toEqual({ Al: 2, S: 3, O: 12 });
  });

  it("parses hydrates with the · separator", () => {
    const cuso4 = parseFormula("CuSO4·5H2O");
    expect(counts(cuso4.elements)).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    expect(cuso4.molarMass).toBeCloseTo(249.677, 3);
  });

  it("computes molar masses for common compounds", () => {
    // H 1.008×2 + S 32.06 + O 15.999×4
    expect(parseFormula("H2SO4").molarMass).toBeCloseTo(98.072, 3);
    // Ca 40.078 + C 12.011 + O 15.999×3
    expect(parseFormula("CaCO3").molarMass).toBeCloseTo(100.086, 3);
    expect(parseFormula("CH4").molarMass).toBeCloseTo(16.043, 3);
  });

  it("throws on unknown elements", () => {
    expect(() => parseFormula("H2X")).toThrow(/unknown element symbol 'X'/);
  });

  it("throws on bad syntax", () => {
    expect(() => parseFormula("")).toThrow(/empty formula/);
    expect(() => parseFormula("2H2O")).toThrow(/unexpected leading coefficient/);
    expect(() => parseFormula("(OH)2(HO")).toThrow(/unbalanced parentheses/);
    expect(() => parseFormula("H2@")).toThrow(/unexpected character/);
  });
});