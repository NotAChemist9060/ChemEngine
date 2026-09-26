/**
 * Ion splitting and salt building — the two things the aqueous rules stand on.
 *
 * The split is checked against real salts, including the ones a string hack
 * gets wrong (`FeCl3` is Fe³⁺ + 3 Cl⁻, `NH4Cl` has no metal cation, and the
 * hydroxide ion writes as `OH` because the graph says oxygen is the atom bonded
 * to the hydrogen). The build is then checked end to end: a salt rebuilt from
 * its own ions has to land on the same ΔGf° in `data/thermo.json`, which is the
 * one proof that the formula written is the species the table meant.
 */
import { describe, expect, it } from "vitest";
import { buildSalt, ionFromFormula, ionLabel, isSimpleSalt, splitIons } from "../src/rules/ions.ts";
import { parseSpeciesInput, type SpeciesInput } from "../src/rules/types.ts";
import { dGfOf } from "../src/thermo/table.ts";

function species(formula: string): SpeciesInput {
  return parseSpeciesInput(formula);
}

function split(formula: string) {
  const found = splitIons(species(formula));
  expect(found, formula).toBeDefined();
  return found!;
}

describe("splitIons", () => {
  it("reads the ions off the graph", () => {
    const ions = split("CuSO4");
    expect(ions.cations.map(ionLabel)).toEqual(["Cu+2"]);
    expect(ions.anions.map(ionLabel)).toEqual(["SO4-2"]);
    expect(ions.neutrals).toEqual([]);
  });

  it("keeps every copy of a repeated ion", () => {
    const ions = split("FeCl3");
    expect(ions.cations.map(ionLabel)).toEqual(["Fe+3"]);
    expect(ions.anions.map(ionLabel)).toEqual(["Cl-", "Cl-", "Cl-"]);
  });

  it("spells a group the way a chemist writes it, not in Hill order", () => {
    // The graph is what makes these readable: O is the atom bonded to H, and S
    // is the one bonded to all four oxygens. Hill order would give HO and O4S.
    expect(split("NaOH").anions.map(ionLabel)).toEqual(["OH-"]);
    expect(split("K2SO4").anions.map(ionLabel)).toEqual(["SO4-2"]);
    expect(split("Na2CO3").anions.map(ionLabel)).toEqual(["CO3-2"]);
    expect(split("Ca(NO3)2").anions.map(ionLabel)).toEqual(["NO3-", "NO3-"]);
    expect(split("NH4Cl").cations.map(ionLabel)).toEqual(["NH4+"]);
  });

  it("counts the atoms of a polyatomic ion, hydrogens included", () => {
    const sulfate = split("CuSO4").anions[0]!;
    expect([...sulfate.counts]).toEqual([["S", 1], ["O", 4]]);
    const hydroxide = split("NaOH").anions[0]!;
    expect([...hydroxide.counts]).toEqual([["O", 1], ["H", 1]]);
  });

  it("says there is no split for a neutral molecule", () => {
    expect(splitIons(species("H2O"))).toBeUndefined();
    expect(splitIons(species("CH3COOH"))).toBeUndefined();
    expect(splitIons(species("CH4"))).toBeUndefined();
  });

  it("says there is no split when one side of the charge is missing", () => {
    // A formula with no structure at all, and a bare metal, are both not salts.
    expect(splitIons(species("Zn"))).toBeUndefined();
    expect(splitIons(species("CH3COONa"))).toBeUndefined();
  });
});

describe("isSimpleSalt", () => {
  it("accepts a salt with nothing else attached", () => {
    expect(isSimpleSalt(species("CuSO4"))).toBe(true);
    expect(isSimpleSalt(species("AgNO3"))).toBe(true);
    expect(isSimpleSalt(species("CH3COOH"))).toBe(false);
    expect(isSimpleSalt(species("H2O"))).toBe(false);
  });
});

describe("buildSalt", () => {
  /** Rebuild the salt a formula is made of and return the written formula. */
  function rebuild(formula: string): string {
    const ions = split(formula);
    return buildSalt(ions.cations[0]!, ions.anions[0]!);
  }

  it("balances the charges to get the ratio", () => {
    expect(rebuild("NaCl")).toBe("NaCl");
    expect(rebuild("K2SO4")).toBe("K2SO4");
    expect(rebuild("CaCl2")).toBe("CaCl2");
    expect(rebuild("Ca(NO3)2")).toBe("Ca(NO3)2");
    expect(rebuild("Ba(OH)2")).toBe("Ba(OH)2");
    expect(rebuild("FeCl3")).toBe("FeCl3");
  });

  it("crosses a 3+ cation with a 2- anion to get 2 : 3", () => {
    expect(rebuild("Al2(SO4)3")).toBe("Al2(SO4)3");
    const ions = split("Al2(SO4)3");
    expect(buildSalt(ions.cations[0]!, ions.anions[0]!)).toBe("Al2(SO4)3");
  });

  it("brackets a repeated group instead of scaling its subscripts", () => {
    // (SO4)3, never (SO12)3: the group repeats, the subscript inside it does not.
    const sulfate = split("CuSO4").anions[0]!;
    const aluminium = ionFromFormula("Al^3+")!;
    expect(buildSalt(aluminium, sulfate)).toBe("Al2(SO4)3");
  });

  it("round-trips through the structure layer", () => {
    for (const formula of ["NaCl", "K2SO4", "Ca(NO3)2", "Ba(OH)2", "Al2(SO4)3", "FeCl3", "NH4Cl"]) {
      const rebuilt = rebuild(formula);
      const again = split(rebuilt);
      expect(again.cations.map(ionLabel), formula).toEqual(split(formula).cations.map(ionLabel));
      expect(again.anions.map(ionLabel), formula).toEqual(split(formula).anions.map(ionLabel));
    }
  });

  it("lands on the same ΔGf° the table already had for that salt", () => {
    // The end-to-end proof: a formula written from ion counts is the species the
    // table means, or the whole aqueous half of the rules layer is wrong.
    for (const formula of ["NaCl", "K2SO4", "Ca(NO3)2", "Ba(OH)2", "Al2(SO4)3", "FeCl3", "CuSO4", "AgNO3", "NaOH"]) {
      const rebuilt = rebuild(formula);
      const written = dGfOf(formula, "aq");
      const fromRebuild = dGfOf(rebuilt, "aq");
      if (!written.known || !fromRebuild.known) {
        throw new Error(`${formula}: ${written.known ? "" : written.reason} ${rebuilt}: ${fromRebuild.known ? "" : fromRebuild.reason}`);
      }
      expect(fromRebuild.kj, rebuilt).toBe(written.kj);
    }
  });

  it("refuses a pair that could not be a salt", () => {
    const sodium = ionFromFormula("Na+")!;
    const chloride = ionFromFormula("Cl-")!;
    expect(() => buildSalt(chloride, sodium)).toThrow(/not a cation/);
    expect(() => buildSalt(sodium, sodium)).toThrow(/not an anion/);
    expect(() => buildSalt(sodium, ionFromFormula("H2O")!)).toThrow(/not an anion/);
  });
});

describe("ionFromFormula", () => {
  it("reads the spellings a rule or a person might use", () => {
    const expected = ["Cl-", "SO4-2", "CO3-2", "Ca+2", "Na+", "OH-"];
    const written = ["Cl-", "SO4^2-", "CO3-2", "Ca++", "Na+", "OH-"];
    expect(written.map((f) => ionLabel(ionFromFormula(f)!))).toEqual(expected);
  });

  it("does not read a digit before the sign as the charge", () => {
    // `Ca2+` is the human convention but an ambiguous one: it could be a
    // doubly-charged calcium or a pair of neutral calcium atoms with a plus on
    // them. The engine takes the atom part whole and the sign alone, which is
    // the only reading that cannot contradict a real formula.
    const misread = ionFromFormula("Ca2+")!;
    expect(misread.charge).toBe(1);
    expect([...misread.counts]).toEqual([["Ca", 2]]);
  });

  it("keeps the spelling it was given, so an organic anion reads as written", () => {
    const acetate = ionFromFormula("CH3COO-")!;
    expect(acetate.formula).toBe("CH3COO");
    expect(acetate.charge).toBe(-1);
    expect([...acetate.counts]).toEqual([["C", 2], ["H", 3], ["O", 2]]);
  });

  it("returns undefined for something that is not an ion", () => {
    expect(ionFromFormula("Xy9+")).toBeUndefined();
    expect(ionFromFormula("not a formula")).toBeUndefined();
    expect(ionFromFormula("")).toBeUndefined();
  });
});

describe("ionLabel", () => {
  it("writes the charge the way a formula does", () => {
    expect(ionLabel(ionFromFormula("Na+")!)).toBe("Na+");
    expect(ionLabel(ionFromFormula("Ca^2+")!)).toBe("Ca+2");
    expect(ionLabel(ionFromFormula("SO4^2-")!)).toBe("SO4-2");
    expect(ionLabel(ionFromFormula("H2O")!)).toBe("H2O");
  });
});
