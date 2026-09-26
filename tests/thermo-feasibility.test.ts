/**
 * Feasibility verdicts, ranking, and the one-sentence backing per candidate.
 *
 * The four verdicts are pinned to real numbers: methane burns (spontaneous,
 * −817.9), CaCO₃ needs a kiln (nonspontaneous, +131.01), ammonia dissolving in
 * water hovers right in the marginal band (NH₃(g) → NH₃(aq) is −10.05), and
 * H₂ + Cl₂ → 2HCl(g) is judged *unknown* because the table prices hydrochloric
 * acid only as (aq) — never a guessed sign. Ranking always puts the most
 * negative known ΔG on top and every unknown below all of them, still
 * labelled, and a skipReason candidate never appears at all.
 */
import { describe, expect, it } from "vitest";
import { balanceEquation, type BalancedEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";
import { explain, feasibilityOf, MARGINAL_BAND_KJ, rankFeasibility, verdictOf } from "../src/thermo/feasibility.ts";
import { predict } from "../src/rules/ruleEngine.ts";
import type { Candidate } from "../src/rules/types.ts";

function balanced(eq: string): BalancedEquation {
  return balanceEquation(parseEquation(eq));
}

function candidateFor(...tokens: string[]): Candidate & { balanced: BalancedEquation } {
  const candidates = predict(tokens.join(" ")).candidates;
  const found = candidates.find((c) => c.balanced !== undefined);
  expect(found, `${tokens.join(" ")}: expected a balanced candidate`).toBeDefined();
  return found as Candidate & { balanced: BalancedEquation };
}

describe("verdictOf", () => {
  it("methane combustion is spontaneous", () => {
    const gibbs = reactionGibbs(balanced("CH4(g) + O2(g) -> CO2(g) + H2O(l)"));
    expect(verdictOf(gibbs)).toBe("spontaneous");
  });

  it("calcium carbonate decomposition is nonspontaneous at +131.01", () => {
    const gibbs = reactionGibbs(balanced("CaCO3(s) -> CaO(s) + CO2(g)"));
    expect(gibbs.dGrxnKj).toBeCloseTo(131.01, 2);
    expect(verdictOf(gibbs)).toBe("nonspontaneous");
  });

  it("ammonia dissolving sits inside the marginal band, both directions", () => {
    // NH3(g) -> NH3(aq) is −10.05; its reverse +10.05. Each is a real sign
    // with a real number, and both belong to the band around zero.
    const down = reactionGibbs(balanced("NH3(g) -> NH3(aq)"));
    const up = reactionGibbs(balanced("NH3(aq) -> NH3(g)"));
    expect(down.dGrxnKj).toBeCloseTo(-10.05, 2);
    expect(up.dGrxnKj).toBeCloseTo(10.05, 2);
    expect(Math.abs(down.dGrxnKj!) <= MARGINAL_BAND_KJ).toBe(true);
    expect(verdictOf(down)).toBe("marginal");
    expect(verdictOf(up)).toBe("marginal");
  });

  it("an unpriced reaction is unknown, never a guessed sign", () => {
    const gibbs = reactionGibbs(balanced("H2(g) + Cl2(g) -> HCl(g)"));
    expect(gibbs.known).toBe(false);
    expect(verdictOf(gibbs)).toBe("unknown");
  });
});

describe("one explanation per candidate", () => {
  it("a spontaneous card states the verdict and the number", () => {
    const feasibility = feasibilityOf(candidateFor("Mg", "O2"));
    expect(feasibility.rule).toBe("simpleMaterials");
    expect(feasibility.verdict).toBe("spontaneous");
    expect(feasibility.dGrxnKj).toBeCloseTo(-1138.6, 2);
    expect(feasibility.explanation).toContain("spontaneous");
    expect(feasibility.explanation).toContain("-1138.60");
    expect(feasibility.explanation).toContain("runs as written");
    expect(feasibility.proposed).toBe("Mg(s) + O2(g) -> MgO(s)");
  });

  it("a nonspontaneous card says it needs energy input", () => {
    const feasibility = feasibilityOf(candidateFor("CaCO3"));
    expect(feasibility.verdict).toBe("nonspontaneous");
    expect(feasibility.explanation).toContain("needs energy input");
  });

  it("an unknown card names the missing ΔGf° — never a guess", () => {
    const feasibility = feasibilityOf(candidateFor("H2", "Cl2"));
    expect(feasibility.verdict).toBe("unknown");
    expect(feasibility.dGrxnKj).toBeUndefined();
    expect(feasibility.explanation).toContain("cannot be judged");
    expect(feasibility.explanation).toContain("HCl");
    expect(feasibility.missing.map((m) => m.formula)).toEqual(["HCl"]);
  });

  it("a marginal card says the direction can flip", () => {
    const feasibility = feasibilityOf({
      rule: "test",
      proposed: "NH3(g) -> NH3(aq)",
      reasoning: "dissolving",
      balanced: balanced("NH3(g) -> NH3(aq)"),
    });
    expect(feasibility.verdict).toBe("marginal");
    expect(feasibility.explanation).toContain("direction can flip");
  });
});

describe("ranking", () => {
  it("reads known-ΔG ascending, most favourable first", () => {
    const ranked = rankFeasibility([candidateFor("CaCO3"), candidateFor("CH4", "O2"), candidateFor("Mg", "O2")]);
    expect(ranked.map((f) => f.proposed)).toEqual([
      "Mg(s) + O2(g) -> MgO(s)", // −1138.6
      "CH4(g) + O2(g) -> CO2(g) + 2H2O(l)", // −817.9
      "CaCO3(s) -> CaO(s) + CO2(g)", // +131.01
    ]);
  });

  it("puts every unknown-ΔG candidate last, still labelled", () => {
    const ranked = rankFeasibility([candidateFor("H2", "Cl2"), candidateFor("CaCO3"), candidateFor("CH4", "O2")]);
    expect(ranked.map((f) => f.verdict)).toEqual(["spontaneous", "nonspontaneous", "unknown"]);
    expect(ranked[2]!.explanation).toContain("cannot be judged");
  });

  it("keeps unknown candidates in their original order among themselves", () => {
    // Neither NH3+HCl nor H2+Cl2 prices (HCl(g) is absent from the table);
    // their mutual order must not wobble.
    const ranked = rankFeasibility([candidateFor("NH3", "HCl"), candidateFor("H2", "Cl2")]);
    expect(ranked.map((f) => f.rule)).toEqual(["combination", "simpleMaterials"]);
    expect(ranked[0]!.proposed).toContain("NH4Cl");
    expect(ranked[1]!.proposed).toContain("HCl");
  });

  it("a skipReason candidate is not a reaction and never ranks", () => {
    const skip: Candidate = { rule: "clumsy", proposed: "Mg + O2 -> H2O", reasoning: "x", skipReason: "cannot be balanced" };
    const ranked = rankFeasibility([skip, candidateFor("Mg", "O2")]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.rule).toBe("simpleMaterials");
  });
});