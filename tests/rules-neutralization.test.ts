/**
 * Neutralisation: acid + base → salt + water, checked against the numbers.
 *
 * The three plan cases are pinned: HCl + NaOH at −79.9 (the value the milestone
 * is measured against), H2SO4 + Ca(OH)2 (which must come out as *insoluble*
 * CaSO4(s), because T6's solubility table says so — two rules agreeing by
 * construction), and CH3COOH + NaOH at −52.8. The curated acid→anion table is
 * re-derived from the acids themselves in `the table is right`, so a typo in
 * one of the twelve entries cannot survive the suite.
 *
 * The declines carry the plan's honesty: a lone acid says the base is missing,
 * a lone base says the acid is missing, ammonia is refused because it has no
 * hydroxide to give (its salt is made directly, not plus water), a carbonate
 * points at its three-product reaction, and an acid with no curated anion
 * admits it rather than guessing a salt.
 */
import { describe, expect, it } from "vitest";
import { neutralization } from "../src/rules/neutralization.ts";
import { parseSpeciesInput, type PredictContext, type Proposal } from "../src/rules/types.ts";
import { parseFormula } from "../src/core/formula.ts";
import { balanceEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";
import { splitChargedFormula } from "../src/thermo/table.ts";
import { ACID_ANIONS } from "../src/rules/neutralization.ts";

function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

function proposals(...tokens: string[]): Proposal[] {
  const ctx = context(...tokens);
  if (!neutralization.applies(ctx)) return [];
  return neutralization.propose(ctx).proposals;
}

function declined(...tokens: string[]) {
  return neutralization.propose(context(...tokens)).declined;
}

function balanced(...tokens: string[]): BalancedEquation {
  const found = proposals(...tokens);
  expect(found, `expected one neutralisation of ${tokens.join(" + ")}`).toHaveLength(1);
  return balanceEquation(parseEquation(found[0]!.equation));
}

function dGrxn(...tokens: string[]): number {
  const result = reactionGibbs(balanced(...tokens));
  expect(result.known, `${tokens.join(" + ")}: ${result.missing.map((m) => m.reason).join("; ")}`).toBe(true);
  return result.dGrxnKj!;
}

import type { BalancedEquation } from "../src/core/balance.ts";

describe("the gate", () => {
  it("opens for an acid, a base, or both", () => {
    expect(neutralization.applies(context("HCl", "NaOH"))).toBe(true);
    expect(neutralization.applies(context("HCl"))).toBe(true);
    expect(neutralization.applies(context("NaOH"))).toBe(true);
  });

  it("shuts for anything that is neither", () => {
    for (const input of [["NaCl"], ["H2O"], ["NaCl", "H2O"], ["CH4", "O2"], ["Zn"]]) {
      expect(neutralization.applies(context(...input)), input.join(" ")).toBe(false);
    }
  });
});

describe("what it writes", () => {
  it("neutralises HCl and NaOH at the milestone's value", () => {
    expect(dGrxn("HCl", "NaOH")).toBeCloseTo(-79.89, 2);
    expect(balanced("HCl", "NaOH").coefficients).toEqual([1, 1, 1, 1]);
  });

  it("writes a strong acid with a diprotic base", () => {
    // Ca(OH)2 has two hydroxides, so it takes two HCl: the balancer supplies
    // the 2, and the value is exactly twice the single case.
    expect(balanced("HCl", "Ca(OH)2").coefficients).toEqual([2, 1, 1, 2]);
    expect(dGrxn("HCl", "Ca(OH)2")).toBeCloseTo(-159.78, 2);
  });

  it("writes a diprotic acid with a strong base", () => {
    expect(balanced("H2SO4", "NaOH").coefficients).toEqual([1, 2, 1, 2]);
    expect(dGrxn("H2SO4", "NaOH")).toBeCloseTo(-159.78, 2);
  });

  it("lets the solubility rules decide the salt's phase", () => {
    // CaSO4 is on T6's insoluble list, so this one comes out solid and the
    // equation carries the (s). The two rules agree by construction.
    const result = balanced("H2SO4", "Ca(OH)2");
    expect(result.equation.products.map((t) => t.state)).toEqual(["s", "l"]);
    expect(dGrxn("H2SO4", "Ca(OH)2")).toBeCloseTo(-183.46, 2);
  });

  it("neutralises a weak acid too", () => {
    expect(dGrxn("CH3COOH", "NaOH")).toBeCloseTo(-52.8, 1);
  });

  it("keeps the user's typed phases and prices them", () => {
    // A pellet of NaOH is a solid, and the table holds both phases — the engine
    // prices what was asked for, which is 79.9 kJ of salt formation plus the
    // enthalpy gap to dissolve the solid.
    const found = proposals("HCl", "NaOH(s)");
    expect(found[0]!.equation).toBe("HCl(aq) + NaOH(s) -> NaCl(aq) + 2H2O(l)");
    expect(dGrxn("HCl", "NaOH(s)")).toBeCloseTo(-119.5, 1);
  });

  it("names the ions that met in the reasoning line", () => {
    expect(proposals("HCl", "NaOH")[0]!.reasoning).toBe(
      "the acid gives up Cl and the base gives up Na, so they make a salt (NaCl) and water",
    );
    const insoluble = proposals("H2SO4", "Ca(OH)2")[0]!.reasoning;
    expect(insoluble).toContain("an insoluble salt (CaSO4)");
  });

  it("reacts every acid with every base in the list", () => {
    // Two reactants, one shape; and the phase choices do not collide.
    expect(proposals("HCl", "H2SO4", "NaOH", "KOH")).toHaveLength(4);
  });

  it("does not repeat a decline for a shared base", () => {
    // Two acids and one ammonia: the ammonia is named once, not twice.
    expect(declined("H2SO4", "NH3", "HCl")).toHaveLength(1);
  });
});

describe("what it declines", () => {
  it("says a lone acid is missing its base", () => {
    expect(declined("HCl")).toEqual([
      { subject: "HCl", reason: "neutralisation needs a base, and none was given" },
    ]);
  });

  it("says a lone base is missing its acid", () => {
    expect(declined("NaOH")).toEqual([
      { subject: "NaOH", reason: "neutralisation needs an acid, and none was given" },
    ]);
  });

  it("says two acids (or two bases) have no partners", () => {
    expect(declined("HCl", "H2SO4")).toHaveLength(2);
    expect(declined("HCl", "H2SO4").every((d) => d.reason.includes("needs a base"))).toBe(true);
    expect(declined("NaOH", "KOH")).toHaveLength(2);
    expect(declined("NaOH", "KOH").every((d) => d.reason.includes("needs an acid"))).toBe(true);
  });

  it("refuses ammonia: no hydroxide to give up", () => {
    // NH3 + HCl -> NH4Cl is a real reaction, but it makes a salt directly, not
    // salt plus water, and this rule only writes the one shape.
    const answer = declined("HCl", "NH3");
    expect(answer).toHaveLength(1);
    expect(answer[0]!.reason).toContain("no hydroxide ion");
  });

  it("points a carbonate at its three-product reaction", () => {
    // Na2CO3 is a *salt* to the classifier, so this exercises the branch that
    // scans every species rather than just the bases.
    const answer = declined("HCl", "Na2CO3");
    expect(answer.map((d) => d.reason).join(" ")).toContain("salt, water and CO2");
    // And once that is said, the acid does not also complain the base is
    // missing — the base is there, it just reacts differently.
    expect(answer.map((d) => d.reason).some((r) => r.includes("needs a base"))).toBe(false);
  });

  it("admits when it has no anion for an acid", () => {
    // Boric acid is a real acid and a carbonate-free one; the salt it makes is
    // borate, and this table does not claim to know that formula.
    const answer = declined("H3BO3", "NaOH");
    expect(answer).toHaveLength(1);
    expect(answer[0]!.reason).toContain("no anion is known for H3BO3");
    expect(answer[0]!.reason).toContain("cannot be written");
  });
});

describe("the curated acid→anion table is right", () => {
  it("re-derives every anion from the acid itself", () => {
    // Each entry: the acid must be exactly the anion plus the protons it gave
    // up, element for element, and the anion's charge must be the negative of
    // that same count. A typo in a curated anion — an oxygen too many, the
    // wrong hydrogen count — fails here by construction.
    for (const [acidCanonical, anionFormula] of ACID_ANIONS) {
      const entry = parseSpeciesInput(acidCanonical);
      expect(entry.formula, acidCanonical).toBe(acidCanonical);
      const acid = parseFormula(acidCanonical).elements;
      const split = splitChargedFormula(anionFormula);
      expect(split, `${acidCanonical} -> ${anionFormula}`).toBeDefined();
      const anion = parseFormula(split!.atoms).elements;
      const protons = (acid.get("H") ?? 0) - (anion.get("H") ?? 0);
      expect(protons, `${acidCanonical}: proton count`).toBeGreaterThan(0);
      expect(split!.charge, `${acidCanonical}: charge`).toBe(-protons);
      // Everything in the acid that is not in the anion is hydrogen, and it is
      // exactly the protons counted above.
      for (const [symbol, count] of acid) {
        const left = count - (anion.get(symbol) ?? 0);
        if (symbol === "H") continue;
        expect(left, `${acidCanonical}: ${symbol}`).toBe(0);
      }
      for (const [symbol] of anion) {
        expect(acid.has(symbol), `${acidCanonical}: ${symbol} in anion`).toBe(true);
      }
    }
  });

  it("proposes for every acid the classifier can name", () => {
    // The acids a person can type and the acids the rule can price should not
    // drift apart: adding one side without the other is a silent gap. The salt
    // may well be one the table has no ΔGf° for (NaClO4 is not in there); the
    // proposal still has to exist, and the unknown surfaces downstream.
    const known = [
      "HCl", "HBr", "HI", "HF", "H2SO4", "HNO3", "HNO2",
      "H3PO4", "H2CO3", "H2S", "CH3COOH", "HClO4",
    ];
    for (const formula of known) {
      expect(parseSpeciesInput(formula).classification.classes, formula).toContain("acid");
      expect(proposals(formula, "NaOH")).toHaveLength(1);
    }
  });
});