/**
 * The rule engine: every rule fires, proposals balance or skip visibly, and
 * the declines travel with the answer so "no reaction" always comes with a
 * reason.
 *
 * End-to-end each rule's star case lands on its pinned ΔG. The mirror pair is
 * here too: CaCO₃ decomposing (+131.01) and CaO + CO₂ combining (−131.01) are
 * the same ΔGf° values read in opposite directions, and the engine must agree
 * with itself across rules.
 */
import { describe, expect, it } from "vitest";
import { predict, ALL_RULES } from "../src/rules/ruleEngine.ts";
import type { ReactionRule } from "../src/rules/types.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";

function dGrxnOf(...tokens: string[]): { rule: string; dGrxnKj: number } {
  const result = predict(tokens.join(" "));
  expect(result.candidates, `${tokens.join(" ")}: expected a candidate`).toHaveLength(1);
  const candidate = result.candidates[0]!;
  const gibbs = reactionGibbs(candidate.balanced!);
  expect(gibbs.known, `${candidate.proposed}: ${gibbs.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return { rule: candidate.rule, dGrxnKj: gibbs.dGrxnKj! };
}

/** A single-equation fake rule, for exercising the engine alone. */
function rule(name: string, equation: string): ReactionRule {
  return {
    name,
    description: name,
    applies: () => true,
    propose: () => ({
      proposals: [{ equation, reasoning: `${name} proposes ${equation}` }],
      declined: [],
    }),
  };
}

describe("all seven rules fire through the engine", () => {
  it("combustion: methane lands on T4's −817.90", () => {
    const { rule: name, dGrxnKj } = dGrxnOf("CH4", "O2");
    expect(name).toBe("combustion");
    expect(dGrxnKj).toBeCloseTo(-817.9, 2);
  });

  it("neutralization: HCl + NaOH on −79.89", () => {
    const { rule: name, dGrxnKj } = dGrxnOf("NaOH", "HCl");
    expect(name).toBe("neutralization");
    expect(dGrxnKj).toBeCloseTo(-79.89, 2);
  });

  it("single displacement: Zn + CuSO4 on −212.55", () => {
    const { rule: name, dGrxnKj } = dGrxnOf("Zn", "CuSO4");
    expect(name).toBe("singleDisplacement");
    expect(dGrxnKj).toBeCloseTo(-212.55, 2);
  });

  it("double displacement: AgNO3 + NaCl on −55.67", () => {
    const { rule: name, dGrxnKj } = dGrxnOf("AgNO3", "NaCl");
    expect(name).toBe("doubleDisplacement");
    expect(dGrxnKj).toBeCloseTo(-55.67, 2);
  });

  it("simpleMaterials: Mg + O2 on −1138.6", () => {
    const { rule: name, dGrxnKj } = dGrxnOf("Mg", "O2");
    expect(name).toBe("simpleMaterials");
    expect(dGrxnKj).toBeCloseTo(-1138.6, 2);
  });

  it("simpleMaterials: Na + Cl is read as Na + Cl2 and lands on −768.28", () => {
    const { rule: name, dGrxnKj } = dGrxnOf("Na", "Cl");
    expect(name).toBe("simpleMaterials");
    expect(dGrxnKj).toBeCloseTo(-768.28, 2);
  });

  it("decomposition: CaCO3 on the positive +131.01", () => {
    const { rule: name, dGrxnKj } = dGrxnOf("CaCO3");
    expect(name).toBe("decomposition");
    expect(dGrxnKj).toBeCloseTo(131.01, 2);
  });

  it("reads the mirror across rules: CaO + CO2 combines at −131.01", () => {
    // The same ΔGf° values, read the other way — the engine has to agree with
    // itself between combination and decomposition.
    const { rule: name, dGrxnKj } = dGrxnOf("CaO", "CO2");
    expect(name).toBe("combination");
    expect(dGrxnKj).toBeCloseTo(-131.01, 2);
  });
});

describe("the result carries what was asked and what was said", () => {
  it("echoes the species in order", () => {
    const result = predict("CaO CO2");
    expect(result.input).toBe("CaO CO2");
    expect(result.species.map((s) => s.formula)).toEqual(["CaO", "CO2"]);
  });

  it("tolerates spaced + reactant punctuation", () => {
    const spaced = predict("CH4 + O2");
    const plain = predict("CH4 O2");
    expect(spaced).toEqual(plain);
  });

  it("reads a bare element as its standard substance: Na + Cl matches Na + Cl2", () => {
    const bare = predict("Na Cl");
    const diatomic = predict("Na Cl2");
    expect(bare.candidates).toEqual(diatomic.candidates);
    expect(bare.declined).toEqual(diatomic.declined);
  });

  it("no reaction is never silence: N2 + O2 comes back with the refused reason", () => {
    const result = predict("N2 O2");
    expect(result.candidates).toHaveLength(0);
    const reasons = result.declined.map((d) => `${d.subject}: ${d.reason}`).join(" | ");
    expect(reasons).toContain("endothermic");
    expect(reasons).toContain("deliberately omitted");
  });

  it("a lone species gets the rules' reasons, not an empty list", () => {
    const result = predict("CH4");
    expect(result.candidates).toHaveLength(0);
    const reasons = result.declined.map((d) => d.reason).join(" | ");
    expect(reasons).toContain("combustion needs O2");
    expect(reasons).toContain("no decomposition in the curated table for CH4");
  });

  it("a lone salt hears that a swap needs a second salt", () => {
    const result = predict("CaCO3");
    expect(result.candidates).toHaveLength(1);
    expect(result.declined.map((d) => d.reason).join(" | ")).toContain("needs a second salt");
  });

  it("declines are deduplicated across rules", () => {
    const result = predict("NaCl CuSO4");
    const keys = result.declined.map((d) => `${d.subject}\u0000${d.reason}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("dedupe and skips stay visible", () => {
  it("two rules proposing the same reaction keep the first, counted as a duplicate", () => {
    const result = predict("H2 O2", [
      rule("dupA", "H2(g) + O2(g) -> H2O(l)"),
      rule("dupB", "2H2(g) + O2(g) -> 2H2O(l)"),
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.rule).toBe("dupA");
    expect(result.duplicatesDropped).toBe(1);
  });

  it("a proposal that cannot balance becomes a skipReason, never a wrong equation", () => {
    const result = predict("Mg O2", [rule("clumsy", "Mg + O2 -> H2O")]);
    const candidate = result.candidates[0]!;
    expect(candidate.rule).toBe("clumsy");
    expect(candidate.balanced).toBeUndefined();
    expect(candidate.skipReason).toContain("cannot be balanced");
  });

  it("a proposal that cannot parse becomes a skipReason too", () => {
    const result = predict("H2 N2", [rule("mangled", "H2 + N2 ->")]);
    expect(result.candidates[0]!.skipReason).toContain("incomplete");
  });

  it("every candidate carries exactly one of balanced or skipReason", () => {
    const result = predict("Mg O2", [
      ALL_RULES[5]!, // simpleMaterials proposes a clean, balanced reaction
      rule("clumsy", "Mg + O2 -> H2O"),
    ]);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    for (const candidate of result.candidates) {
      const hasBalanced = candidate.balanced !== undefined;
      const hasSkip = candidate.skipReason !== undefined;
      expect(hasBalanced, candidate.rule).not.toBe(hasSkip);
    }
  });
});
