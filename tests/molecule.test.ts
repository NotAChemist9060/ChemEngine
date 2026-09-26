import { describe, expect, it } from "vitest";
import { formatFormula, formatFormulaParts, parseFormula } from "../src/core/formula.ts";
import {
  addAtom,
  addBond,
  allAtomsAre,
  atomCount,
  bondedOrder,
  cloneMolecule,
  components,
  degree,
  emptyMolecule,
  findBond,
  formulaOf,
  formulaString,
  neighbors,
  neighborsByOrder,
  netCharge,
  ringCount,
  atomsInRing,
  symbolCounts,
} from "../src/structure/molecule.ts";

/** Water: O with two implicit H. */
function water() {
  const mol = emptyMolecule();
  addAtom(mol, "O", { hydrogens: 2 });
  return mol;
}

/** Ethanol CH3–CH2–OH. */
function ethanol() {
  const mol = emptyMolecule();
  const c1 = addAtom(mol, "C", { hydrogens: 3 });
  const c2 = addAtom(mol, "C", { hydrogens: 2 });
  const o = addAtom(mol, "O", { hydrogens: 1 });
  addBond(mol, c1, c2);
  addBond(mol, c2, o);
  return mol;
}

/** Benzene: 6-ring, each C with one implicit H. */
function benzene() {
  const mol = emptyMolecule();
  const ring: number[] = [];
  for (let i = 0; i < 6; i++) ring.push(addAtom(mol, "C", { hydrogens: 1 }));
  for (let i = 0; i < 6; i++) addBond(mol, ring[i]!, ring[(i + 1) % 6]!);
  return mol;
}

/** NaCl as two ions: Na+ and Cl-. */
function sodiumChloride() {
  const mol = emptyMolecule();
  const na = addAtom(mol, "Na", { charge: 1 });
  const cl = addAtom(mol, "Cl", { charge: -1 });
  addBond(mol, na, cl);
  return mol;
}

describe("molecule construction", () => {
  it("starts empty and appends atoms with sequential indices", () => {
    const mol = emptyMolecule();
    expect(atomCount(mol)).toBe(0);
    expect(addAtom(mol, "C")).toBe(0);
    expect(addAtom(mol, "O", { charge: -1, hydrogens: 1 })).toBe(1);
    expect(mol.atoms[1]).toEqual({ index: 1, symbol: "O", charge: -1, hydrogens: 1 });
  });

  it("adds bonds in either direction and finds them", () => {
    const mol = emptyMolecule();
    const a = addAtom(mol, "Na", { charge: 1 });
    const b = addAtom(mol, "Cl", { charge: -1 });
    addBond(mol, a, b, 1);
    expect(findBond(mol, a, b)?.order).toBe(1);
    expect(findBond(mol, b, a)?.order).toBe(1);
    expect(findBond(mol, a, a)).toBeUndefined();
  });

  it("rejects programmer errors loudly", () => {
    const mol = emptyMolecule();
    const a = addAtom(mol, "C");
    const b = addAtom(mol, "O");
    expect(() => addBond(mol, a, a)).toThrow(/to itself/);
    expect(() => addBond(mol, a, 9)).toThrow(/out of range/);
    expect(() => neighbors(mol, 42)).toThrow(/out of range/);
  });

  it("rejects duplicate bonds", () => {
    const mol = emptyMolecule();
    const a = addAtom(mol, "C");
    const b = addAtom(mol, "O");
    addBond(mol, a, b);
    expect(() => addBond(mol, b, a)).toThrow(/duplicate bond/);
  });
});

describe("graph queries", () => {
  it("reports neighbours, degree and bond order sums", () => {
    const mol = ethanol();
    expect(neighbors(mol, 1).sort()).toEqual([0, 2]);
    expect(degree(mol, 1)).toBe(2);
    expect(degree(mol, 0)).toBe(1);
    expect(bondedOrder(mol, 1)).toBe(2);
  });

  it("separates neighbours by bond order", () => {
    const mol = emptyMolecule();
    const c = addAtom(mol, "C");
    const o1 = addAtom(mol, "O");
    const o2 = addAtom(mol, "O");
    addBond(mol, c, o1, 2);
    addBond(mol, c, o2, 1);
    expect(neighborsByOrder(mol, c, 2)).toEqual([o1]);
    expect(neighborsByOrder(mol, c, 1)).toEqual([o2]);
    expect(bondedOrder(mol, c)).toBe(3);
  });

  it("sums formal charges", () => {
    expect(netCharge(ethanol())).toBe(0);
    expect(netCharge(sodiumChloride())).toBe(0);
    const mol = emptyMolecule();
    addAtom(mol, "Na", { charge: 1 });
    addAtom(mol, "OH", { charge: -1 });
    expect(netCharge(mol)).toBe(0);
  });

  it("counts heavy atoms per symbol, ignoring implicit H", () => {
    expect([...symbolCounts(ethanol())]).toEqual([["C", 2], ["O", 1]]);
    expect(allAtomsAre(ethanol(), "C")).toBe(false);
    expect(allAtomsAre(ethanol(), "O")).toBe(false);
    expect(allAtomsAre(emptyMolecule(), "C")).toBe(false);
  });
});

describe("fragments and rings", () => {
  it("finds one component for a covalent molecule", () => {
    expect(components(ethanol())).toEqual([[0, 1, 2]]);
  });

  it("keeps the ions of a salt as separate fragments when unbonded", () => {
    const mol = emptyMolecule();
    const na = addAtom(mol, "Na", { charge: 1 });
    const cl = addAtom(mol, "Cl", { charge: -1 });
    expect(components(mol)).toEqual([[na], [cl]]);
    addBond(mol, na, cl); // an ionic contact bond merges them
    expect(components(mol)).toEqual([[na, cl]]);
  });

  it("keeps the three ions of a calcium oxide unbonded as 3 fragments", () => {
    const mol = emptyMolecule();
    const ca = addAtom(mol, "Ca", { charge: 2 });
    const o1 = addAtom(mol, "O", { charge: -2 });
    const o2 = addAtom(mol, "O", { charge: -2 });
    expect(components(mol)).toEqual([[ca], [o1], [o2]]);
    expect(netCharge(mol)).toBe(-2);
  });

  it("counts rings as bonds − atoms + components", () => {
    expect(ringCount(ethanol())).toBe(0);
    expect(ringCount(benzene())).toBe(1);
    expect(ringCount(sodiumChloride())).toBe(0);
  });

  it("locates a 6-ring and rejects other sizes", () => {
    expect(atomsInRing(benzene(), 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(atomsInRing(ethanol(), 6)).toEqual([]);
  });
});

describe("formula round-trips", () => {
  it("adds implicit hydrogens back into the formula", () => {
    expect(formulaString(water())).toBe("H2O");
    expect(formulaString(ethanol())).toBe("C2H6O");
    expect(formulaString(benzene())).toBe("C6H6");
    expect(formulaString(emptyMolecule())).toBe("");
  });

  it("round-trips graphs through the formula parser", () => {
    for (const build of [water, ethanol, benzene, sodiumChloride]) {
      const mol = build();
      const text = formulaString(mol);
      const counts = formulaOf(mol);
      for (const [sym, n] of parseFormula(text).elements) {
        expect(counts.get(sym), `${text} ${sym}`).toBe(n);
      }
      expect([...parseFormula(text).elements].every(([sym, n]) => counts.get(sym) === n)).toBe(true);
    }
  });

  it("formats hydrates with the middot", () => {
    const parts = [parseFormula("CuSO4").elements, parseFormula("H2O").elements];
    expect(formatFormulaParts(parts)).toBe("CuO4S·H2O");
    expect(formatFormula(parts[0]!)).toBe("CuO4S"); // no carbon → alphabetical
  });
});

describe("Hill-order formula text", () => {
  it("puts carbon first, then hydrogen, then the rest alphabetically", () => {
    expect(formatFormula(new Map([["O", 1], ["H", 2]]))).toBe("H2O");
    expect(formatFormula(new Map([["C", 6], ["H", 12], ["O", 6]]))).toBe("C6H12O6");
    expect(formatFormula(new Map([["C", 2], ["H", 6], ["O", 1]]))).toBe("C2H6O");
    expect(formatFormula(new Map([["O", 2], ["C", 1], ["H", 4]]))).toBe("CH4O2");
  });

  it("is purely alphabetical without carbon", () => {
    expect(formatFormula(new Map([["O", 4], ["S", 1], ["Cu", 1]]))).toBe("CuO4S");
    expect(formatFormula(new Map([["Na", 1], ["Cl", 1]]))).toBe("ClNa");
  });

  it("drops zero counts and omits 1", () => {
    expect(formatFormula(new Map([["C", 1], ["H", 4], ["O", 0]]))).toBe("CH4");
    expect(formatFormula(new Map([["O", 1]]))).toBe("O");
    expect(formatFormula(new Map())).toBe("");
  });

  it("produces text the formula parser reads back identically", () => {
    const cases = ["C6H12O6", "H2O", "NaCl", "C2H5OH", "NH3", "Ca(OH)2"];
    for (const text of cases) {
      const counts = parseFormula(text).elements;
      expect(parseFormula(formatFormula(counts)).elements, text).toEqual(counts);
    }
  });
});

describe("cloning", () => {
  it("copies atoms and bonds so templates can be reused", () => {
    const original = ethanol();
    const copy = cloneMolecule(original);
    addAtom(copy, "N");
    expect(atomCount(original)).toBe(3);
    expect(atomCount(copy)).toBe(4);
    copy.atoms[0]!.hydrogens = 99;
    expect(original.atoms[0]!.hydrogens).toBe(3);
    expect(copy.bonds).not.toBe(original.bonds);
  });
});
