/**
 * Simple materials, checked against the curated element + element table.
 *
 * The report that started this rule: `Na + Cl` must be read as `Na + Cl2` and
 * land on sodium chloride at the pinned −768.28 kJ/mol. Every family is pinned
 * — metal + halogen, metal + oxygen, metal + sulfur, non-metal + non-metal —
 * and the table's honest noes are checked too: N₂ + O₂ (endothermic), Fe + O₂
 * (two oxides), and Na/K + O₂ (peroxide/superoxide, not the simple oxide).
 */
import { describe, expect, it } from "vitest";
import { simpleMaterials } from "../src/rules/simpleMaterials.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { balanceEquation, type BalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!simpleMaterials.applies(ctx)) return [];
  return simpleMaterials.propose(ctx).proposals;
}

function declined(...tokens: string[]) {
  return simpleMaterials.propose(context(...tokens)).declined;
}

function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one simple-material reaction of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

describe("the gate", () => {
  it("opens when a simple substance is named", () => {
    expect(simpleMaterials.applies(context("Na", "Cl"))).toBe(true);
    expect(simpleMaterials.applies(context("Na", "Cl2"))).toBe(true);
    expect(simpleMaterials.applies(context("N2", "O2"))).toBe(true);
    expect(simpleMaterials.applies(context("Fe", "O2"))).toBe(true);
  });

  it("stays quiet when no simple substance is named", () => {
    expect(simpleMaterials.applies(context("CaO", "CO2"))).toBe(false);
    expect(simpleMaterials.applies(context("NaOH", "HCl"))).toBe(false);
  });

  it("stays quiet for a single species — decomposition's question", () => {
    for (const input of [["Na"], ["Cl"], ["O2"]]) {
      expect(simpleMaterials.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("bare element symbols are read as the standard substance", () => {
  it("turns Na + Cl into Na + Cl2 and lands on salt", () => {
    const result = balanced("Na", "Cl");
    expect(result.coefficients).toEqual([2, 1, 2]);
    expect(result.equation.reactants.map((t) => `${t.formula}(${t.state})`)).toEqual(["Na(s)", "Cl2(g)"]);
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["NaCl(s)"]);
    expect(dGrxn("Na", "Cl")).toBeCloseTo(-768.28, 2);
    expect(dGrxn("Na", "Cl2")).toBeCloseTo(-768.28, 2);
    expect(proposals("Na", "Cl")[0]!.equation).toContain("Cl2");
  });

  it("reads a bare H as H2 and a bare O as O2", () => {
    expect(balanced("H", "O").equation.reactants.map((t) => `${t.formula}(${t.state})`)).toEqual([
      "H2(g)",
      "O2(g)",
    ]);
    expect(dGrxn("H", "O")).toBeCloseTo(-474.26, 2);
  });
});

describe("metal + halogen", () => {
  it("burns sodium in chlorine at the report's number", () => {
    expect(dGrxn("Na", "Cl2")).toBeCloseTo(-768.28, 2);
    expect(proposals("Na", "Cl2")[0]!.reasoning).toContain("sodium and chlorine combine");
  });

  it("prices the other common halides", () => {
    expect(balanced("K", "Cl2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("K", "Cl2")).toBeCloseTo(-817.0, 1);
    expect(dGrxn("Ca", "Cl2")).toBeCloseTo(-748.8, 1);
    expect(dGrxn("Mg", "Cl2")).toBeCloseTo(-592.3, 1);
    expect(balanced("Al", "Cl2").coefficients).toEqual([2, 3, 2]);
    expect(dGrxn("Al", "Cl2")).toBeCloseTo(-1257.6, 1);
    expect(dGrxn("Zn", "Cl2")).toBeCloseTo(-369.4, 1);
    expect(dGrxn("Cu", "Cl2")).toBeCloseTo(-161.0, 1);
  });

  it("takes iron to iron(III) chloride in chlorine", () => {
    const result = balanced("Fe", "Cl2");
    expect(result.coefficients).toEqual([2, 3, 2]);
    expect(result.equation.products[0]!.formula).toBe("FeCl3");
    expect(dGrxn("Fe", "Cl2")).toBeCloseTo(-668.0, 1);
  });

  it("prices the bromides too", () => {
    expect(dGrxn("Na", "Br2")).toBeCloseTo(-698.0, 1);
    expect(dGrxn("K", "Br2")).toBeCloseTo(-761.4, 1);
  });

  it("proposes HCl(g) and names the missing ΔGf°", () => {
    const result = balanced("H2", "Cl2");
    expect(result.equation.products.map((t) => `${t.formula}(${t.state})`)).toEqual(["HCl(g)"]);
    const gibbs = reactionGibbs(result);
    expect(gibbs.known).toBe(false);
    expect(gibbs.missing.map((m) => m.reason).join(" ")).toContain("HCl");
  });
});

describe("metal + oxygen", () => {
  it("pins the oxides", () => {
    expect(dGrxn("Mg", "O2")).toBeCloseTo(-1138.6, 2);
    expect(balanced("Ca", "O2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("Ca", "O2")).toBeCloseTo(-1206.84, 1);
    expect(balanced("Cu", "O2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("Cu", "O2")).toBeCloseTo(-259.4, 1);
    expect(balanced("Al", "O2").coefficients).toEqual([4, 3, 2]);
    expect(dGrxn("Al", "O2")).toBeCloseTo(-3164.6, 1);
    expect(balanced("Zn", "O2").coefficients).toEqual([2, 1, 2]);
    expect(dGrxn("Zn", "O2")).toBeCloseTo(-641.0, 1);
  });
});

describe("metal + sulfur", () => {
  it("pins the sulfides", () => {
    expect(balanced("Fe", "S").coefficients).toEqual([1, 1, 1]);
    expect(dGrxn("Fe", "S")).toBeCloseTo(-100.4, 1);
    expect(dGrxn("Zn", "S")).toBeCloseTo(-201.3, 1);
  });
});

describe("non-metal + non-metal", () => {
  it("makes water, ammonia, carbon dioxide and sulfur dioxide", () => {
    expect(dGrxn("H2", "O2")).toBeCloseTo(-474.26, 2);
    expect(dGrxn("N2", "H2")).toBeCloseTo(-32.9, 1);
    expect(dGrxn("C", "O2")).toBeCloseTo(-394.36, 2);
    expect(dGrxn("S", "O2")).toBeCloseTo(-300.19, 2);
  });
});

describe("the table's honest noes", () => {
  it("refuses N2 + O2 with the endothermic reason", () => {
    expect(declined("N2", "O2")[0]!.reason).toContain("endothermic");
    expect(declined("N2", "O2")[0]!.reason).toContain("deliberately omitted");
  });

  it("refuses iron because its oxide is ambiguous", () => {
    expect(declined("Fe", "O2")[0]!.reason).toContain("Fe2O3 and Fe3O4");
    expect(declined("Fe", "O2")[0]!.reason).toContain("does not guess");
  });

  it("refuses sodium and potassium burning to a simple oxide", () => {
    expect(declined("Na", "O2")[0]!.reason).toContain("peroxide");
    expect(declined("K", "O2")[0]!.reason).toContain("superoxide");
  });

  it("tells every other pair the curated table has no entry — never silence", () => {
    expect(declined("Mg", "N2")[0]!.reason).toBe("the curated simple-materials table has no entry for Mg + N2");
    expect(declined("Na", "S")[0]!.reason).toContain("no entry");
  });
});

describe("compound-involving pairs belong to combination", () => {
  it("does not speak for an element + compound pair", () => {
    const verdict = simpleMaterials.propose(context("Na", "H2O"));
    expect(verdict.proposals).toEqual([]);
    expect(verdict.declined).toEqual([]);
  });
});
