import { describe, expect, it } from "vitest";
import { mergeInto, parseIonSet, parseStructure } from "../src/structure/dsl.ts";
import {
  components,
  formulaOf,
  formulaString,
  netCharge,
  ringCount,
  addAtom,
  emptyMolecule,
  neighbors,
} from "../src/structure/molecule.ts";

describe("structure DSL", () => {
  it("parses a single atom with implicit hydrogens", () => {
    const mol = parseStructure("O(H)(H)");
    expect(mol.atoms).toHaveLength(1);
    expect(mol.atoms[0]).toMatchObject({ symbol: "O", hydrogens: 2, charge: 0 });
    expect(formulaString(mol)).toBe("H2O");
  });

  it("treats (H) as an implicit hydrogen, never a node", () => {
    const mol = parseStructure("C(H)(H)(H)(H)");
    expect(mol.atoms).toHaveLength(1);
    expect(mol.atoms[0]).toMatchObject({ symbol: "C", hydrogens: 4 });
    expect(formulaString(mol)).toBe("CH4");
  });

  it("reads H as a hydrogen modifier, not an atom", () => {
    expect(formulaString(parseStructure("CH4"))).toBe("CH4");
    expect(formulaString(parseStructure("C(H)(H)(H)H"))).toBe("CH4");
    expect(formulaString(parseStructure("OH2"))).toBe("H2O");
    expect(formulaString(parseStructure("CH3OH"))).toBe("CH4O");
    // no H node is ever created, so a chain position H is an error
    expect(() => parseStructure("C#H")).toThrow(/hydrogen is written as a modifier/);
    expect(() => parseStructure("H")).toThrow(/hydrogen is written as a modifier/);
  });

  it("builds a chain through nested branches", () => {
    const mol = parseStructure("C(H)(H)(C(H)(H)(O(H)))"); // ethanol
    expect(formulaString(mol)).toBe("C2H6O");
    expect(mol.bonds).toHaveLength(2);
    expect(mol.atoms.map((a) => a.symbol)).toEqual(["C", "C", "O"]);
    expect(neighbors(mol, 1)).toEqual([0, 2]);
  });

  it("reads bond prefixes", () => {
    const ethene = parseStructure("C(H)(H)=C(H)(H)");
    expect(formulaString(ethene)).toBe("C2H4");
    expect(ethene.bonds[0]?.order).toBe(2);
    const ethyne = parseStructure("C(H)#C(H)");
    expect(formulaString(ethyne)).toBe("C2H2");
    expect(ethyne.bonds[0]?.order).toBe(3);
  });

  it("closes ring labels", () => {
    const benzene = parseStructure("C%1=CC=CC=C%1");
    expect(formulaString(benzene)).toBe("C6H6");
    expect(benzene.atoms).toHaveLength(6);
    expect(benzene.bonds).toHaveLength(6);
    expect(ringCount(benzene)).toBe(1);
    expect(components(benzene)).toEqual([[0, 1, 2, 3, 4, 5]]);
    expect(benzene.bonds.filter((b) => b.order === 2)).toHaveLength(3);
  });

  it("supports several ring labels and rings", () => {
    const naphthalene = parseStructure("C%1%2=CC=CC=C%1C=CC=C%2");
    expect(formulaString(naphthalene)).toBe("C10H8");
    expect(ringCount(naphthalene)).toBe(2);
  });

  it("can be asked not to fill hydrogens", () => {
    expect(formulaString(parseStructure("C%1=CC=CC=C%1"))).toBe("C6H6");
    expect(formulaString(parseStructure("C%1=CC=CC=C%1", { fillHydrogens: false }))).toBe("C6");
  });

  it("accumulates per-atom charges", () => {
    expect(netCharge(parseStructure("Na+"))).toBe(1);
    expect(netCharge(parseStructure("Ca++"))).toBe(2);
    expect(netCharge(parseStructure("O--"))).toBe(-2);
    expect(netCharge(parseStructure("O(H)-"))).toBe(-1);
    expect(formulaString(parseStructure("N(H)(H)(H)(H)+"))).toBe("H4N");
    expect(netCharge(parseStructure("N(H)(H)(H)(H)+"))).toBe(1);
  });

  it("parses a polyatomic ion as atoms", () => {
    const sulfate = parseStructure("S(=O)(=O)(O-)O-");
    expect(formulaString(sulfate)).toBe("O4S");
    expect(netCharge(sulfate)).toBe(-2);
    expect(sulfate.atoms).toHaveLength(5);
  });

  it("keeps charged atoms free of inferred hydrogens", () => {
    expect(formulaString(parseStructure("C-#O+"))).toBe("CO");
    expect(formulaString(parseStructure("N+=O-"))).toBe("NO");
  });

  it("rejects lowercase element symbols rather than guessing (co is cobalt, not CO)", () => {
    expect(() => parseStructure("c(H)(H)(H)H")).toThrow(/expected an element symbol/);
  });
});

describe("ion sets", () => {
  it("keeps ions as separate fragments", () => {
    const mol = parseIonSet(["Na+", "Cl-"]);
    expect(components(mol)).toEqual([[0], [1]]);
    expect(netCharge(mol)).toBe(0);
    expect(formulaString(mol)).toBe("ClNa");
  });

  it("balances multi-ion salts", () => {
    const mol = parseIonSet(["Ca++", "Cl-", "Cl-"]);
    expect(components(mol)).toEqual([[0], [1], [2]]);
    expect(netCharge(mol)).toBe(0);
    expect(formulaString(mol)).toBe("CaCl2");
  });

  it("refuses an unbalanced ion set unless asked explicitly", () => {
    expect(() => parseIonSet(["Na+", "Cl-", "Cl-"])).toThrow(/net charge -1/);
    expect(() => parseIonSet(["Na+"])).toThrow(/net charge \+1/);
    const charged = parseIonSet(["Na+"], { allowCharged: true });
    expect(netCharge(charged)).toBe(1);
  });
});

describe("mergeInto", () => {
  it("merges into an existing fragment, offsetting indices", () => {
    const target = parseStructure("O(H)(H)"); // 1 atom: H stays implicit
    const source = parseStructure("C(H)(H)(C(H)(H)(O(H)))"); // 3 atoms
    mergeInto(target, source);
    expect(target.atoms).toHaveLength(4);
    expect(target.bonds).toHaveLength(2);
    expect(formulaString(target)).toBe("C2H8O2");
    for (const bond of target.bonds) {
      expect(bond.a).toBeGreaterThanOrEqual(1);
      expect(bond.b).toBeGreaterThanOrEqual(1);
    }
  });

  it("merges into an empty molecule", () => {
    const target = emptyMolecule();
    mergeInto(target, parseStructure("N(H)(H)(H)"));
    expect(formulaString(target)).toBe("H3N");
  });
});

describe("DSL errors", () => {
  it("rejects empty input", () => {
    expect(() => parseStructure("")).toThrow(/empty structure/);
  });

  it("rejects unknown element symbols", () => {
    expect(() => parseStructure("Xx(H)")).toThrow(/'Xx' is not an element symbol/);
  });

  it("rejects unbalanced parentheses and trailing junk", () => {
    expect(() => parseStructure("C(O")).toThrow(/unexpected end of input/);
    expect(() => parseStructure("C))")).toThrow(/unexpected trailing input/);
    expect(() => parseStructure("C(H)!!")).toThrow(/expected an element symbol, found '!'/);
  });

  it("rejects ring labels that are not closed or not attached to an atom", () => {
    expect(() => parseStructure("C%1")).toThrow(/never closed/);
    expect(() => parseStructure("C%1CC%1%1")).toThrow(/never closed|unexpected/);
    expect(() => parseStructure("C%CC%C")).toThrow(/ring label must be a digit/);
  });

  it("rejects a leading bond with nothing to bond to", () => {
    expect(() => parseStructure("=C")).toThrow(/cannot start a chain with a bond/);
    expect(() => parseStructure("#O")).toThrow(/cannot start a chain with a bond/);
  });
});

describe("formula helpers agree with the DSL", () => {
  it("formulaOf matches formulaString for every fragment shape", () => {
    for (const dsl of ["O(H)(H)", "C(H)(H)(C(H)(H)(O(H)))", "C%1=CC=CC=C%1", "O(=S(=O)=O)(O-)O-"]) {
      const mol = parseStructure(dsl);
      const counts = formulaOf(mol);
      expect([...counts].every(([sym, n]) => n > 0), dsl).toBe(true);
      expect(formulaString(mol), dsl).toBeTruthy();
    }
  });

  it("addAtom defaults are zero", () => {
    const mol = emptyMolecule();
    const i = addAtom(mol, "C");
    expect(mol.atoms[i]).toEqual({ index: 0, symbol: "C", charge: 0, hydrogens: 0 });
  });
});
