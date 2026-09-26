import { describe, expect, it } from "vitest";
import { formatFormula, parseFormula } from "../src/core/formula.ts";
import {
  buildTemplate,
  findTemplate,
  findTemplates,
  TEMPLATES,
  templateFormula,
  templateNames,
} from "../src/structure/templates.ts";
import { components, formulaString, netCharge, ringCount } from "../src/structure/molecule.ts";

/** The registry's core invariant: every template reproduces its own key. */
describe("template registry self-consistency", () => {
  it("every template builds a graph with exactly its canonical key", () => {
    for (const template of TEMPLATES) {
      expect(templateFormula(template), template.formula).toBe(template.key);
    }
  });

  it("every key is the Hill-order form of its conventional formula", () => {
    for (const template of TEMPLATES) {
      const parsed = parseFormula(template.formula);
      expect(template.key, template.formula).toBe(formatFormula(parsed.elements));
    }
  });

  it("every template is neutral overall (salts balance their ions)", () => {
    for (const template of TEMPLATES) {
      expect(netCharge(template.build()), template.formula).toBe(0);
    }
  });

  it("has no duplicate names", () => {
    const names = TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers the species the classifier and M4 rules depend on", () => {
    // Hill-order keys: H2O, H2O4S, ClH, ClNa, C6H6, C2H6O, H3N, CO2, CNa2O3
    for (const key of ["H2O", "H2O4S", "ClH", "ClNa", "C6H6", "C2H6O", "H3N", "CO2", "CNa2O3"]) {
      expect(findTemplate(key), key).toBeDefined();
    }
  });
});

describe("lookup", () => {
  it("finds templates by canonical key", () => {
    expect(findTemplate("H2O")?.name).toBe("water");
    expect(findTemplate("ClNa")?.name).toBe("sodium chloride");
    expect(findTemplate("H2O4S")?.name).toBe("sulfuric acid");
    expect(findTemplate("C6H6")?.name).toBe("benzene");
  });

  it("returns undefined for species that are not curated", () => {
    expect(findTemplate("C7H16")).toBeUndefined();
    expect(findTemplates("C7H16")).toEqual([]);
    expect(templateNames("C7H16")).toEqual([]);
    expect(buildTemplate("C7H16")).toBeUndefined();
  });

  it("keeps every structure when a formula is ambiguous", () => {
    const matches = findTemplates("C2H6O");
    expect(matches.map((t) => t.name).sort()).toEqual(["dimethyl ether", "ethanol"]);
    // ethanol is registered first and therefore preferred
    expect(findTemplate("C2H6O")?.name).toBe("ethanol");
  });
});

describe("buildTemplate", () => {
  it("returns an independent copy each call", () => {
    const first = buildTemplate("H2O");
    const second = buildTemplate("H2O");
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
    first!.atoms[0]!.hydrogens = 99;
    expect(buildTemplate("H2O")!.atoms[0]!.hydrogens).toBe(2);
    expect(templateFormula(TEMPLATES[0]!)).toBeTruthy();
  });
});

describe("curated structures have the right shape", () => {
  it("water is one O with two H", () => {
    const mol = buildTemplate("H2O")!;
    expect(mol.atoms).toHaveLength(1);
    expect(components(mol)).toEqual([[0]]);
    expect(formulaString(mol)).toBe("H2O");
  });

  it("sulfuric acid is S(=O)2(OH)2 — the evidence the classifier cites", () => {
    const mol = buildTemplate("H2O4S")!;
    expect(mol.atoms).toHaveLength(5); // S + 2 O double + 2 OH
    const s = mol.atoms.find((a) => a.symbol === "S")!;
    const hydroxyls = mol.atoms.filter((a) => a.symbol === "O" && a.hydrogens === 1);
    expect(hydroxyls).toHaveLength(2);
    expect(s.hydrogens).toBe(0);
    expect(mol.bonds.filter((b) => b.order === 2)).toHaveLength(2);
    expect(ringCount(mol)).toBe(0);
  });

  it("acetic acid has a carboxyl group", () => {
    const mol = buildTemplate("C2H4O2")!;
    const hydroxyls = mol.atoms.filter((a) => a.symbol === "O" && a.hydrogens === 1);
    expect(hydroxyls).toHaveLength(1);
    expect(mol.bonds.filter((b) => b.order === 2)).toHaveLength(1);
  });

  it("benzene is a 6-ring with three double bonds", () => {
    const mol = buildTemplate("C6H6")!;
    expect(mol.atoms).toHaveLength(6);
    expect(ringCount(mol)).toBe(1);
    expect(mol.bonds.filter((b) => b.order === 2)).toHaveLength(3);
  });

  it("toluene is a benzene ring plus a methyl", () => {
    const mol = buildTemplate("C7H8")!;
    expect(mol.atoms.filter((a) => a.symbol === "C")).toHaveLength(7);
    expect(ringCount(mol)).toBe(1);
    expect(mol.atoms.filter((a) => a.hydrogens === 3)).toHaveLength(1);
  });

  it("glucose is a 6-ring with five hydroxyls", () => {
    const mol = buildTemplate("C6H12O6")!;
    expect(mol.atoms.filter((a) => a.symbol === "C")).toHaveLength(6);
    expect(ringCount(mol)).toBe(1);
    expect(mol.atoms.filter((a) => a.symbol === "O" && a.hydrogens === 1)).toHaveLength(5);
  });

  it("salts are separate ions", () => {
    const nacl = buildTemplate("ClNa")!;
    expect(components(nacl)).toEqual([[0], [1]]);
    const cacl2 = buildTemplate("CaCl2")!;
    expect(components(cacl2)).toEqual([[0], [1], [2]]);
    const sulfate = buildTemplate("CuO4S")!;
    expect(components(sulfate)).toEqual([[0], [1, 2, 3, 4, 5]]); // Cu2+ + SO4^2-
  });

  it("metal hydroxides are a cation plus hydroxide anions", () => {
    const caoh2 = buildTemplate("CaH2O2")!;
    expect(components(caoh2)).toEqual([[0], [1], [2]]);
    expect(caoh2.atoms.filter((a) => a.symbol === "O" && a.charge === -1)).toHaveLength(2);
  });
});
