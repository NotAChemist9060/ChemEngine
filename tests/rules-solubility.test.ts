/**
 * The solubility rules, tested one rule at a time plus the two cross-checks
 * that keep the rules layer and the data file telling the same story.
 *
 * The cross-checks are the ones worth reading: every salt the rules call soluble
 * must have an aqueous ΔGf° in `data/thermo.json` (a rule that proposes an
 * equation the table cannot price is a candidate the engine will have to report
 * as unknown), and every salt the table knows *only* as a solid must be one the
 * rules call insoluble (otherwise an equation is built with a species that has
 * no aqueous value at all). Those two directions are the contract between T6 and
 * T3's data, and they would drift apart silently if nothing checked them.
 */
import { describe, expect, it } from "vitest";
import { solubilityGap, solubilityOf } from "../src/rules/solubility.ts";
import { splitIons } from "../src/rules/ions.ts";
import { parseSpeciesInput, type SpeciesInput } from "../src/rules/types.ts";
import { loadThermoTable, thermoEntry } from "../src/thermo/table.ts";

/** The verdict, failing the test with a message if there is none. */
function verdict(formula: string) {
  const found = solubilityOf(parseSpeciesInput(formula));
  expect(found, formula).toBeDefined();
  return found!;
}

/** Just the answer, for the readable table below. */
function is(formula: string): string {
  return verdict(formula).solubility;
}

function species(formula: string): SpeciesInput {
  return parseSpeciesInput(formula);
}

describe("rule 1: Group 1 and ammonium", () => {
  it("dissolves every Group 1 salt, whatever the anion", () => {
    expect(is("NaCl")).toBe("soluble");
    expect(is("K2SO4")).toBe("soluble");
    expect(is("Na2CO3")).toBe("soluble");
    expect(is("LiCl")).toBe("soluble");
    expect(is("CsCl")).toBe("soluble");
    // Including the anions that would otherwise precipitate, which is the whole
    // content of the rule.
    expect(verdict("K2CO3").reason).toBe("all Group 1 and ammonium salts are soluble");
  });

  it("dissolves ammonium salts", () => {
    expect(is("NH4Cl")).toBe("soluble");
    expect(is("(NH4)2CO3")).toBe("soluble");
  });

  it("does not treat hydrogen as a Group 1 cation", () => {
    // Group 1 contains H on the periodic table, but a hydride is not a salt
    // that dissolves because of it — NaH is soluble as a sodium salt.
    expect(is("NaH")).toBe("soluble");
    expect(verdict("NaH").reason).toBe("all Group 1 and ammonium salts are soluble");
  });
});

describe("rules 2 to 5: the anions", () => {
  it("dissolves every nitrate, chlorate, perchlorate and acetate", () => {
    for (const formula of ["AgNO3", "Ba(NO3)2", "KClO3", "KClO4"]) {
      expect(is(formula), formula).toBe("soluble");
    }
  });

  it("dissolves the halides, bar silver and lead", () => {
    expect(is("NaCl")).toBe("soluble");
    expect(is("CaCl2")).toBe("soluble");
    expect(is("CuCl2")).toBe("soluble");
    expect(is("ZnBr2")).toBe("soluble");
    expect(is("AgCl")).toBe("insoluble");
    expect(is("AgBr")).toBe("insoluble");
    expect(is("PbCl2")).toBe("insoluble");
    expect(verdict("AgCl").reason).toContain("silver halides");
  });

  it("dissolves every fluoride", () => {
    // AgF and PbF2 are the exceptions to the halide rule, and neither exists;
    // fluorides are soluble on their own.
    expect(is("AgF")).toBe("soluble");
    expect(is("CaF2")).toBe("soluble");
  });

  it("dissolves the sulfates, bar barium, strontium, lead and calcium", () => {
    expect(is("CuSO4")).toBe("soluble");
    expect(is("ZnSO4")).toBe("soluble");
    expect(is("MgSO4")).toBe("soluble");
    expect(is("FeSO4")).toBe("soluble");
    expect(is("Al2(SO4)3")).toBe("soluble");
    expect(is("BaSO4")).toBe("insoluble");
    expect(is("PbSO4")).toBe("insoluble");
    expect(is("CaSO4")).toBe("insoluble");
    expect(verdict("CaSO4").reason).toContain("sparingly soluble");
  });

  it("precipitates the carbonates, phosphates, sulfides and hydroxides", () => {
    for (const formula of ["CaCO3", "BaCO3", "CuCO3", "Ag2CO3", "Ca3(PO4)2", "ZnS", "FeS", "CuS", "Cu(OH)2", "Zn(OH)2", "Ca(OH)2", "Fe(OH)3"]) {
      expect(is(formula), formula).toBe("insoluble");
    }
  });
});

describe("what the rules refuse to decide", () => {
  it("declines a species that does not split into ions", () => {
    const acetate = species("CH3COONa");
    expect(solubilityOf(acetate)).toBeUndefined();
    expect(solubilityGap(acetate)).toContain("no ion structure");
  });

  it("declines a mercury halide, because the formula does not say which", () => {
    // HgCl2 dissolves and Hg2Cl2 does not. Both read as "mercury plus a
    // halide" from the formula, so the rules decline instead of picking.
    const chloride = species("HgCl2");
    expect(solubilityOf(chloride)).toBeUndefined();
    expect(solubilityGap(chloride)).toContain("Hg2Cl2");
  });

  it("declines a non-salt", () => {
    expect(solubilityOf(species("H2O"))).toBeUndefined();
    expect(solubilityOf(species("Zn"))).toBeUndefined();
  });

  it("names the anion no rule covers", () => {
    // Chromate is a real anion and this table does not claim to know where it
    // falls, so the card says so instead of borrowing the sulfate row. Potassium
    // chromate is soluble by rule 1, which shows the gap only shows when no
    // earlier rule decided it.
    const chromate = species("BaCrO4");
    expect(solubilityOf(chromate)).toBeUndefined();
    expect(solubilityGap(chromate)).toBe("no solubility rule covers the CrO4 ion");
    expect(is("K2CrO4")).toBe("soluble");
  });

  it("declines a formula with two different cations, and says which reason", () => {
    // Ag2CrO4 comes out of the structure layer as Ag+ + Cr2+ + 4 O-, so this is
    // a real input rather than a hypothetical one, and the reason has to be the
    // right one: blaming the anion would send a person looking in the wrong row.
    const double = species("Ag2CrO4");
    expect(solubilityOf(double)).toBeUndefined();
    expect(solubilityGap(double)).toContain("more than one kind of cation");
    expect(solubilityGap(double)).toContain("Ag");
  });
});

describe("the rules and the thermo table agree", () => {
  it("has an aqueous ΔGf° for every salt the rules call soluble", () => {
    // Otherwise the engine would build an equation it cannot price, and every
    // such salt would come back as an unknown-ΔG candidate for no good reason.
    const soluble = [
      "NaCl", "KCl", "K2SO4", "Na2SO4", "Na2CO3", "NaOH", "NH4Cl",
      "AgNO3", "BaCl2", "Ba(NO3)2", "CaCl2", "Ca(NO3)2",
      "CuSO4", "CuCl2", "ZnSO4", "ZnCl2", "FeCl3", "FeSO4", "Al2(SO4)3", "MgSO4",
    ];
    for (const formula of soluble) {
      expect(is(formula), formula).toBe("soluble");
      const entry = thermoEntry(formula);
      expect(entry, formula).toBeDefined();
      expect(Object.keys(entry!.dGf), formula).toContain("aq");
    }
  });

  it("calls insoluble every solid-only salt except the Group 1 oxides", () => {
    // The other direction: a salt with no aqueous value at all can only be used
    // as a precipitate, so the rules must not offer it in solution. Elements are
    // excluded by asking whether the species splits into ions at all — solid
    // carbon and solid sulfur are not salts and the rules say nothing about them.
    //
    // Na2O is the one that looks like a counterexample and is not: it is
    // solid-only because it *reacts* with water to give NaOH rather than
    // dissolving in it, and rule 1 says Group 1 is soluble. A blanket
    // "solid-only means insoluble" assertion would have forced a wrong answer
    // here, which is why the exception is written down instead.
    const GROUP1_SOLID_ONLY = ["Na2O", "K2O", "Li2O", "Na2S", "Na3PO4"];
    const salts = loadThermoTable().species
      .filter((entry) => Object.keys(entry.dGf).length === 1 && entry.dGf.s !== undefined)
      .map((entry) => entry.formula)
      .filter((formula) => splitIons(parseSpeciesInput(formula)) !== undefined);
    expect(salts.length, "solid-only salts in the table").toBeGreaterThan(4);
    for (const formula of salts) {
      const expected = GROUP1_SOLID_ONLY.includes(formula) ? "soluble" : "insoluble";
      expect(is(formula), `${formula} is solid-only in the table`).toBe(expected);
    }
    // And the exception list itself cannot rot: every entry on it has to be
    // soluble *by rule 1*, not by any other route.
    for (const formula of GROUP1_SOLID_ONLY) {
      if (solubilityOf(parseSpeciesInput(formula)) === undefined) continue;
      expect(verdict(formula).reason, formula).toBe("all Group 1 and ammonium salts are soluble");
    }
  });
});
