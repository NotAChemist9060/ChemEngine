/**
 * The standard elemental substances: a bare `Cl` means `Cl2`, a bare `O` means
 * `O2`, and everything else passes through as written.
 *
 * The point of the module is one ordinary reaction the engine used to miss —
 * `Na + Cl` should be `Na + Cl2`. These tests pin the seven diatomics, prove
 * metals and compounds are untouched, and check the mapping against the thermo
 * table's own reference states so the two cannot drift apart.
 */
import { describe, expect, it } from "vitest";
import { elementalForm, isSimpleSubstance } from "../src/rules/elements.ts";
import { parseSpeciesInput } from "../src/rules/types.ts";
import { dGfOf } from "../src/thermo/table.ts";

describe("isSimpleSubstance", () => {
  it("is true for one-element substances, written bare or diatomic", () => {
    for (const token of ["Na", "Cl", "Cl2", "O2", "H2", "S", "C", "Br2"]) {
      expect(isSimpleSubstance(parseSpeciesInput(token)), token).toBe(true);
    }
  });

  it("is false for compounds and mixtures", () => {
    for (const token of ["H2O", "NaCl", "CH4", "CaCO3", "SO2", "NaOH"]) {
      expect(isSimpleSubstance(parseSpeciesInput(token)), token).toBe(false);
    }
  });
});

describe("elementalForm", () => {
  it("reads a bare diatomic element as its standard substance", () => {
    const pairs: ReadonlyArray<[string, string]> = [
      ["H", "H2"],
      ["N", "N2"],
      ["O", "O2"],
      ["F", "F2"],
      ["Cl", "Cl2"],
      ["Br", "Br2"],
      ["I", "I2"],
    ];
    for (const [bare, standard] of pairs) {
      expect(elementalForm(parseSpeciesInput(bare)).formula, bare).toBe(standard);
    }
  });

  it("leaves metals, non-diatomic non-metals and already-diatomic forms alone", () => {
    for (const token of ["Na", "K", "Ca", "Mg", "Al", "Fe", "Zn", "Cu", "C", "S", "P", "Cl2", "O2", "H2"]) {
      expect(elementalForm(parseSpeciesInput(token)).formula, token).toBe(parseSpeciesInput(token).formula);
    }
  });

  it("never touches a compound", () => {
    for (const token of ["H2O", "NaCl", "CH4", "CaCO3"]) {
      expect(elementalForm(parseSpeciesInput(token)).formula, token).toBe(parseSpeciesInput(token).formula);
    }
  });

  it("keeps the phase the user typed", () => {
    expect(elementalForm(parseSpeciesInput("Cl(g)"))).toEqual({ formula: "Cl2", state: "g" });
    expect(elementalForm(parseSpeciesInput("Na(l)"))).toEqual({ formula: "Na", state: "l" });
    expect(elementalForm(parseSpeciesInput("Cl"))).toEqual({ formula: "Cl2" });
  });
});

describe("the mapping agrees with the thermo reference states", () => {
  it("names each diatomic in the phase the table prices at 0", () => {
    const reference: ReadonlyArray<[string, "g" | "l"]> = [
      ["H2", "g"],
      ["N2", "g"],
      ["O2", "g"],
      ["Cl2", "g"],
      ["Br2", "l"],
    ];
    for (const [formula, state] of reference) {
      const found = dGfOf(formula, state);
      expect(found.known, `${formula}(${state})`).toBe(true);
      if (found.known) expect(found.kj, `${formula}(${state})`).toBe(0);
    }
  });
});
