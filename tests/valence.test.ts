import { describe, expect, it } from "vitest";
import {
  anionCharge,
  blockOf,
  cationCharge,
  commonCharges,
  hasValence,
  isAlkaliMetal,
  isAlkalineEarth,
  isChalcogen,
  isHalogen,
  isMainGroup,
  isMetal,
  isMetalloid,
  isNonMetal,
  isNobleGas,
  isPnicogen,
  isSkeletonElement,
  preferredCharge,
  preferredValence,
  valenceStates,
  canonicalSymbol,
} from "../src/structure/valence.ts";

describe("element families", () => {
  it("classifies metals, non-metals and metalloids", () => {
    for (const s of ["Na", "K", "Ca", "Fe", "Cu", "Zn", "Ag", "Au", "Pb", "U", "Al", "Sn"])
      expect(isMetal(s), s).toBe(true);
    for (const s of ["H", "C", "N", "O", "F", "P", "S", "Cl", "Se", "Br", "I", "Ar"])
      expect(isMetal(s), s).toBe(false);
    for (const s of ["B", "Si", "Ge", "As", "Sb", "Te"]) {
      expect(isMetal(s), s).toBe(false);
      expect(isMetalloid(s), s).toBe(true);
      expect(isNonMetal(s), s).toBe(false);
    }
  });

  it("treats hydrogen as a non-metal, not an alkali metal", () => {
    expect(isNonMetal("H")).toBe(true);
    expect(isAlkaliMetal("H")).toBe(false);
    expect(isAlkaliMetal("Li")).toBe(true);
    expect(isAlkaliMetal("Na")).toBe(true);
    expect(isAlkaliMetal("K")).toBe(true);
  });

  it("knows the reactive families", () => {
    expect(["F", "Cl", "Br", "I", "At"].every(isHalogen)).toBe(true);
    expect(isHalogen("S")).toBe(false);
    expect(["O", "S", "Se", "Te", "Po"].every(isChalcogen)).toBe(true);
    expect(["Be", "Mg", "Ca", "Sr", "Ba", "Ra"].every(isAlkalineEarth)).toBe(true);
    expect(["He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"].every(isNobleGas)).toBe(true);
    expect(["N", "P", "As", "Sb", "Bi"].every(isPnicogen)).toBe(true);
  });

  it("derives the periodic block", () => {
    expect(blockOf("H")).toBe("s");
    expect(blockOf("Na")).toBe("s");
    expect(blockOf("Fe")).toBe("d");
    expect(blockOf("Cu")).toBe("d");
    expect(blockOf("O")).toBe("p");
    expect(blockOf("Cl")).toBe("p");
    expect(blockOf("Ce")).toBe("f");
    expect(blockOf("U")).toBe("f");
    expect(blockOf("Zz")).toBeUndefined();
  });

  it("knows main-group elements", () => {
    expect(isMainGroup("C")).toBe(true);
    expect(isMainGroup("S")).toBe(true);
    expect(isMainGroup("Fe")).toBe(false);
    expect(isMainGroup("Ce")).toBe(false);
  });

  it("knows which elements extend covalent skeletons", () => {
    expect(isSkeletonElement("C")).toBe(true);
    expect(isSkeletonElement("N")).toBe(true);
    expect(isSkeletonElement("O")).toBe(true);
    expect(isSkeletonElement("Si")).toBe(true); // metalloids chain too
    expect(isSkeletonElement("H")).toBe(false); // H terminates, it does not chain
    expect(isSkeletonElement("Ar")).toBe(false);
    expect(isSkeletonElement("Na")).toBe(false);
  });

  it("keeps metal / metalloid / non-metal mutually exclusive", () => {
    for (const el of ["Na", "Fe", "Cu", "Si", "B", "C", "O", "Cl", "Se", "I", "H", "Xe"]) {
      const flags = [isMetal(el), isMetalloid(el), isNonMetal(el)];
      expect(flags.filter(Boolean), el).toHaveLength(1);
    }
  });

  it("canonicalizes symbols case-insensitively", () => {
    expect(canonicalSymbol("fe")).toBe("Fe");
    expect(canonicalSymbol(" o ")).toBe("O");
    expect(canonicalSymbol("zz")).toBeUndefined();
  });
});

describe("valences", () => {
  it("uses the curated value where the group rule would be wrong", () => {
    expect(preferredValence("C")).toBe(4);
    expect(preferredValence("N")).toBe(3); // not 5
    expect(preferredValence("O")).toBe(2);
    expect(preferredValence("S")).toBe(2); // not 6
    expect(preferredValence("P")).toBe(3);
    expect(preferredValence("Cl")).toBe(1);
  });

  it("derives main-group valences from the group", () => {
    expect(preferredValence("F")).toBe(1);
    expect(preferredValence("Si")).toBe(4);
    expect(preferredValence("Br")).toBe(1);
    expect(preferredValence("I")).toBe(1);
    expect(preferredValence("Se")).toBe(2);
  });

  it("gives alkali and alkaline earth metals their ionic valences", () => {
    expect(preferredValence("Na")).toBe(1);
    expect(preferredValence("K")).toBe(1);
    expect(preferredValence("Ca")).toBe(2);
    expect(preferredValence("Mg")).toBe(2);
    expect(preferredValence("Al")).toBe(3);
    expect(preferredValence("Zn")).toBe(2);
  });

  it("returns 0 for noble gases and unknown elements", () => {
    expect(preferredValence("Ne")).toBe(0);
    expect(preferredValence("He")).toBe(0);
    expect(preferredValence("Zz")).toBe(0);
  });

  it("lists every valence state, ascending", () => {
    expect(valenceStates("C")).toEqual([4]);
    expect(valenceStates("N")).toEqual([3, 5]);
    expect(valenceStates("S")).toEqual([2, 4, 6]);
    expect(valenceStates("Cl")).toEqual([1, 3, 5, 7]);
    expect(valenceStates("P")).toEqual([3, 5]);
    expect(valenceStates("O")).toEqual([2]);
    expect(valenceStates("Zz")).toEqual([]);
  });

  it("hasValence matches the state list", () => {
    expect(hasValence("S", 6)).toBe(true);
    expect(hasValence("S", 3)).toBe(false);
    expect(hasValence("C", 4)).toBe(true);
    expect(hasValence("Zz", 1)).toBe(false);
  });
});

describe("ionic charges", () => {
  it("gives cations their positive charge", () => {
    expect(cationCharge("Na")).toBe(1);
    expect(cationCharge("Ca")).toBe(2);
    expect(cationCharge("Al")).toBe(3);
    expect(cationCharge("Fe")).toBe(2);
    expect(cationCharge("Cu")).toBe(1);
  });

  it("gives anions their negative charge", () => {
    expect(anionCharge("Cl")).toBe(-1);
    expect(anionCharge("O")).toBe(-2);
    expect(anionCharge("N")).toBe(-3);
    expect(anionCharge("S")).toBe(-2);
  });

  it("returns 0 when the element forms no ion of that sign", () => {
    expect(cationCharge("Cl")).toBe(0);
    expect(anionCharge("Na")).toBe(0);
  });

  it("lists all charges ascending and picks a preferred one", () => {
    expect(commonCharges("Fe")).toEqual([2, 3]);
    expect(commonCharges("Cu")).toEqual([1, 2]);
    expect(commonCharges("H")).toEqual([-1, 1]);
    expect(preferredCharge("Ca")).toBe(2);
    expect(preferredCharge("O")).toBe(-2);
    expect(preferredCharge("C")).toBe(0);
    expect(commonCharges("Zz")).toEqual([]);
  });
});
