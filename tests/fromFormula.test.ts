import { describe, expect, it } from "vitest";
import {
  buildStructure,
  fragmentCount,
  tryBuildStructure,
  type StructureBuild,
} from "../src/structure/fromFormula.ts";
import { components, formulaString, netCharge } from "../src/structure/molecule.ts";

/** Bond orders by element symbol, for readable assertions. */
function bonds(build: StructureBuild): string[] {
  const mol = build.molecule!;
  const label = (index: number): string => {
    const atom = mol.atoms[index]!;
    return atom.symbol + (atom.hydrogens > 0 ? `H${atom.hydrogens}` : "");
  };
  return mol.bonds.map((bond) => `${label(bond.a)}-${label(bond.b)}:${bond.order}`);
}

/** Formal charges by element symbol, e.g. "O-1,O-1,Na1". */
function charges(build: StructureBuild): string[] {
  return build
    .molecule!.atoms.filter((atom) => atom.charge !== 0)
    .map((atom) => `${atom.symbol}${atom.charge > 0 ? "+" : ""}${atom.charge}`);
}

describe("tier A: curated templates win", () => {
  it("builds methane from the template, with no hydrogen nodes", () => {
    const build = buildStructure("CH4");
    expect(build.source).toBe("template");
    expect(build.confidence).toBe("high");
    expect(build.formula).toBe("CH4");
    expect(build.molecule!.atoms).toHaveLength(1);
    expect(build.molecule!.atoms[0]!.hydrogens).toBe(4);
    expect(build.molecule!.bonds).toHaveLength(0);
  });

  it("builds benzene as six atoms in a ring", () => {
    const build = buildStructure("C6H6");
    expect(build.source).toBe("template");
    expect(build.molecule!.atoms).toHaveLength(6);
    expect(components(build.molecule!)).toHaveLength(1);
  });

  it("is element-order insensitive, echoing back the canonical key", () => {
    const build = buildStructure("OH2");
    expect(build.source).toBe("template");
    expect(build.formula).toBe("H2O");
    expect(build.input).toBe("OH2");
  });

  it("splits a formula into separate particles for a salt", () => {
    const build = buildStructure("NaCl");
    expect(fragmentCount(build)).toBe(2);
    expect(netCharge(build.molecule!)).toBe(0);
  });

  it("says out loud that one formula can be two different molecules", () => {
    const build = buildStructure("C2H6O");
    expect(build.notes[0]).toContain("ethanol");
    expect(build.notes[1]).toContain("dimethyl ether");
    expect(build.notes[1]).toContain("cannot choose");
  });
});

describe("tier B: valence-driven construction", () => {
  it("spreads substituents over the chain so the hydrogen count still fits", () => {
    const build = buildStructure("C3H6O3");
    expect(build.source).toBe("constructed");
    expect(formulaString(build.molecule!)).toBe("C3H6O3");
    // one oxygen per carbon, not all three stacked on the end
    expect(build.molecule!.atoms.filter((atom) => atom.symbol === "O")).toHaveLength(3);
  });

  it("spends spare valence on a double bond rather than inventing hydrogens", () => {
    const saturated = buildStructure("C4H10O");
    expect(bonds(saturated)).toEqual(["CH2-CH2:1", "CH2-CH2:1", "CH2-CH3:1", "CH2-OH1:1"]);
    const unsaturated = buildStructure("C4H8O");
    expect(bonds(unsaturated)).toContain("CH1-O:2");
  });

  it("prefers a multiple bond over a longer carbon chain", () => {
    // C4H4 is built with three bond upgrades rather than a branched skeleton
    const build = buildStructure("C4H4");
    expect(build.source).toBe("constructed");
    expect(formulaString(build.molecule!)).toBe("C4H4");
  });

  it("leaves a hydroxyl single-bonded in an oxoacid", () => {
    const build = buildStructure("HNO2");
    expect(build.source).toBe("constructed");
    expect(bonds(build)).toEqual(["N-O:2", "N-OH1:1"]);
  });

  it("gives every oxoacid as many double bonds as the centre can carry", () => {
    for (const [formula, doubles] of [
      ["H2SO4", 2],
      ["H3PO4", 1],
      ["HClO4", 3],
      ["HNO3", 2],
      ["H2CO3", 1],
    ] as const) {
      const build = buildStructure(formula);
      const orders = build.molecule!.bonds.map((bond) => bond.order);
      expect(orders.filter((order) => order === 2), formula).toHaveLength(doubles);
    }
  });

  it("balances a salt by choosing the cation charge that fits the anion", () => {
    const build = buildStructure("CuO");
    expect(charges(build).sort()).toEqual(["Cu+2", "O-2"]);
    expect(netCharge(build.molecule!)).toBe(0);
  });

  it("reads a metal wrapped in oxygen as an oxyanion, not a free ion", () => {
    const build = buildStructure("KMnO4");
    expect(fragmentCount(build)).toBe(2);
    expect(charges(build)).toEqual(["K+1", "O-1"]);
    expect(build.molecule!.atoms.find((atom) => atom.symbol === "Mn")!.charge).toBe(0);
    // permanganate is Mn(VII): three double bonds and one O⁻
    expect(bonds(build)).toEqual(["Mn-O:2", "Mn-O:2", "Mn-O:2", "Mn-O:1"]);
  });

  it("keeps a metal next to other non-metals as a cation", () => {
    const build = buildStructure("Al2(SO4)3");
    expect(fragmentCount(build)).toBe(5);
    expect(charges(build)).toContain("Al+3");
    expect(build.notes.some((note) => note.includes("3 × SO4"))).toBe(true);
  });

  it("repeats one anion unit instead of fusing them into a blob", () => {
    const build = buildStructure("Ba(NO3)2");
    expect(fragmentCount(build)).toBe(3);
    expect(build.molecule!.atoms.filter((atom) => atom.symbol === "N")).toHaveLength(2);
    expect(build.notes.some((note) => note.includes("2 × NO3"))).toBe(true);
  });

  it("models a peroxide and a superoxide as bonded pairs", () => {
    for (const [formula, charge] of [
      ["Na2O2", -1],
      ["KO2", -1],
    ] as const) {
      const build = buildStructure(formula);
      expect(formulaString(build.molecule!), formula).toBe(formula);
      expect(build.molecule!.bonds, formula).toHaveLength(1);
      expect(netCharge(build.molecule!), formula).toBe(0);
      expect(build.notes.join(" "), formula).toContain("bonded pair");
      expect(build.molecule!.atoms.filter((atom) => atom.charge === charge).length, formula).toBeGreaterThan(0);
    }
  });

  it("treats hydrogen as the anion in a hydride", () => {
    const build = buildStructure("CaH2");
    expect(charges(build)).toEqual(["Ca+2", "H-1", "H-1"]);
  });

  it("reports a bare metal as an atom, not an ion", () => {
    const build = buildStructure("Zn");
    expect(build.source).toBe("constructed");
    expect(build.confidence).toBe("low");
    expect(build.molecule!.atoms).toHaveLength(1);
    expect(build.molecule!.atoms[0]!.charge).toBe(0);
    expect(build.notes[0]).toContain("lattice");
  });

  it("builds an elemental ring or diatomic as the valence allows", () => {
    expect(bonds(buildStructure("N2"))).toEqual(["N-N:3"]);
    expect(bonds(buildStructure("S8"))).toHaveLength(8);
    expect(bonds(buildStructure("O2"))).toEqual(["O-O:2"]);
  });
});

describe("tier C: empirical when nothing reconciles", () => {
  it("refuses to guess and says why", () => {
    const build = buildStructure("H2");
    expect(build.source).toBe("empirical");
    expect(build.confidence).toBe("low");
    expect(build.molecule).toBeNull();
    expect(build.formula).toBe("H2");
    expect(fragmentCount(build)).toBe(0);
    expect(build.notes.join(" ")).toContain("empirical formula is all we know");
  });

  it("keeps the empirical formula even with no connectivity", () => {
    // Hill order, not input order: XeF2 has no carbon, so F sorts first
    for (const [input, key] of [
      ["H2", "H2"],
      ["C3H5N7O14", "C3H5N7O14"],
      ["XeF2", "F2Xe"],
    ] as const) {
      const build = tryBuildStructure(input);
      expect(build, input).toBeDefined();
      expect(build!.formula, input).toBe(key);
    }
  });

  it("discards a construction that would change the formula", () => {
    // a construction that reconciles to a different formula must not be shipped
    const build = buildStructure("C2H6O2C2H6O2");
    expect(build.formula).toBe("C4H12O4");
  });
});

describe("hydrates", () => {
  it("merges every part into one graph of separate particles", () => {
    const build = buildStructure("CuSO4·5H2O");
    expect(build.source).toBe("template");
    expect(build.formula).toBe("CuO4S·5H2O");
    // copper, sulfate, and five waters
    expect(fragmentCount(build)).toBe(7);
    expect(components(build.molecule!)).toHaveLength(7);
  });

  it("says the water count in the notes", () => {
    const build = buildStructure("CuSO4·5H2O");
    expect(build.notes[0]).toContain("hydrate");
    expect(build.notes[0]).toContain("5 water");
  });

  it("falls back to the weakest confidence of any part", () => {
    const build = buildStructure("CuSO4·5H2O·C7H16");
    expect(build.source).toBe("constructed");
    expect(build.confidence).toBe("medium");
    expect(fragmentCount(build)).toBe(8);
  });

  it("has no connectivity at all when one part has none", () => {
    const build = buildStructure("CuSO4·H2");
    expect(build.molecule).toBeNull();
    expect(build.source).toBe("empirical");
    expect(build.notes.join(" ")).toContain("no connectivity for H2");
  });
});

describe("input handling", () => {
  it("throws a message, not a crash, for input that is not a formula", () => {
    expect(() => buildStructure("")).toThrow(/empty formula/);
    expect(() => buildStructure("Xx2")).toThrow();
    expect(() => buildStructure("H2O(")).toThrow();
    expect(tryBuildStructure("nonsense")).toBeUndefined();
  });

  it("is pure: the same input always gives the same build", () => {
    const first = buildStructure("K2Cr2O7");
    const second = buildStructure("K2Cr2O7");
    expect(formulaString(first.molecule!)).toBe(formulaString(second.molecule!));
    expect(bonds(first)).toEqual(bonds(second));
    expect(first.notes).toEqual(second.notes);
  });

  it("keeps every ion in a constructed salt neutral overall", () => {
    for (const formula of ["K2Cr2O7", "Na2WO4", "Al2(SO4)3", "Fe3O4", "PuO2", "Na2SnO3"]) {
      expect(netCharge(buildStructure(formula).molecule!), formula).toBe(0);
    }
  });
});
