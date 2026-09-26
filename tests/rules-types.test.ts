/**
 * The rule vocabulary: what a rule is given, what it may say, and what comes
 * back. The chemistry is T7–T11; this is the contract those rules are written
 * against, so the tests here are about the shape and the two promises made in
 * the module docs — a declined pair comes back with a reason, and a proposed
 * equation round-trips through the parser with its phases intact.
 */
import { describe, expect, it } from "vitest";
import {
  findSpecies,
  formatEquation,
  formatTerm,
  parseSpeciesInput,
  speciesPairs,
  type Candidate,
  type PredictContext,
  type ReactionRule,
} from "../src/rules/types.ts";
import { balanceEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";

/** The context a rule is handed for a set of typed species. */
function context(...tokens: string[]): PredictContext {
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

describe("parseSpeciesInput", () => {
  it("keeps what the user typed alongside what the formula is", () => {
    const species = parseSpeciesInput("Ca(OH)2");
    expect(species.input).toBe("Ca(OH)2");
    expect(species.formula).toBe("CaH2O2");
    expect(species.classification.primary).toBe("base");
    expect(species.structure.molecule).not.toBeNull();
  });

  it("takes a typed phase off and keeps it", () => {
    const species = parseSpeciesInput("NaOH(aq)");
    expect(species.input).toBe("NaOH");
    expect(species.formula).toBe("HNaO");
    expect(species.state).toBe("aq");
  });

  it("accepts an uppercase phase, as a person types it", () => {
    expect(parseSpeciesInput("CuSO4(AQ)").state).toBe("aq");
    expect(parseSpeciesInput("H2O(L)").state).toBe("l");
  });

  it("leaves the state unset when none was typed", () => {
    expect(parseSpeciesInput("H2O").state).toBeUndefined();
  });

  it("rejects a token that is only a phase", () => {
    expect(() => parseSpeciesInput("(aq)")).toThrow(/nothing but a phase/);
  });

  it("rejects a token that is not a formula at all", () => {
    expect(() => parseSpeciesInput("banana")).toThrow();
  });
});

describe("context helpers", () => {
  it("gives every unordered pair, in the order the species were named", () => {
    const pairs = speciesPairs(context("Zn", "CuSO4", "H2O"));
    expect(pairs.map(([a, b]) => `${a.input}+${b.input}`)).toEqual([
      "Zn+CuSO4",
      "Zn+H2O",
      "CuSO4+H2O",
    ]);
  });

  it("gives no pair at all for fewer than two species", () => {
    expect(speciesPairs(context("CH4"))).toEqual([]);
    expect(speciesPairs({ input: "", species: [] })).toEqual([]);
  });

  it("finds the first species that passes a test", () => {
    const ctx = context("CH4", "O2", "C2H6");
    const hydrocarbon = findSpecies(ctx, (s) => s.classification.primary === "hydrocarbon");
    expect(hydrocarbon?.formula).toBe("CH4");
    expect(findSpecies(ctx, (s) => s.formula === "N2")).toBeUndefined();
  });
});

describe("proposal formatting", () => {
  it("omits a coefficient of one and writes every phase", () => {
    expect(formatTerm({ formula: "H2O", state: "l" })).toBe("H2O(l)");
    expect(formatTerm({ formula: "H2O", state: "l", coefficient: 2 })).toBe("2H2O(l)");
    expect(formatTerm({ formula: "O2", state: "g" })).toBe("O2(g)");
  });

  it("leaves out a phase the rule does not know", () => {
    expect(formatTerm({ formula: "C6H6" })).toBe("C6H6");
  });

  it("writes an equation the core parser can read back", () => {
    const text = formatEquation(
      [{ formula: "CH4", state: "g" }, { formula: "O2", state: "g" }],
      [{ formula: "CO2", state: "g" }, { formula: "H2O", state: "l", coefficient: 2 }],
    );
    expect(text).toBe("CH4(g) + O2(g) -> CO2(g) + 2H2O(l)");
    const balanced = balanceEquation(parseEquation(text));
    expect(balanced.coefficients).toEqual([1, 2, 1, 2]);
    // The phases survive the round trip, which is the point of writing them.
    expect(balanced.equation.products.map((p) => p.state)).toEqual(["g", "l"]);
  });
});

describe("a rule written against the contract", () => {
  const isFuel = (s: { classification: { classes: readonly string[] } }): boolean =>
    s.classification.classes.includes("hydrocarbon");
  // O2 classifies as an element, not an oxide: a diatomic molecule of one
  // element is the standard state, not a compound.
  const isOxygen = (s: { formula: string }): boolean => s.formula === "O2";

  /** A toy rule, shaped like the real ones: it walks the pairs and says no out loud. */
  const toy: ReactionRule = {
    name: "toy",
    description: "burns a hydrocarbon in oxygen",
    applies: (ctx) => ctx.species.some((s) => isFuel(s) && ctx.species.some(isOxygen)),
    propose: (ctx) => {
      const proposals = [];
      const declined = [];
      for (const [a, b] of speciesPairs(ctx)) {
        const pair = [a, b];
        const fuel = pair.find(isFuel);
        if (fuel !== undefined && pair.some(isOxygen)) {
          proposals.push({
            equation: formatEquation(
              [{ formula: fuel.formula, state: "g" }, { formula: "O2", state: "g" }],
              [{ formula: "CO2", state: "g" }, { formula: "H2O", state: "l" }],
            ),
            reasoning: "a hydrocarbon burns in oxygen",
          });
        } else {
          declined.push({ subject: `${a.input} + ${b.input}`, reason: "not a fuel and oxygen pair" });
        }
      }
      return { proposals, declined };
    },
  };

  it("is gated cheaply and then answers with proposals", () => {
    const ctx = context("CH4", "O2");
    expect(toy.applies(ctx)).toBe(true);
    const verdict = toy.propose(ctx);
    expect(verdict.proposals).toHaveLength(1);
    expect(verdict.proposals[0]!.equation).toBe("CH4(g) + O2(g) -> CO2(g) + H2O(l)");
    expect(verdict.proposals[0]!.reasoning).toBe("a hydrocarbon burns in oxygen");
    expect(verdict.declined).toEqual([]);
  });

  it("says nothing when its gate is shut", () => {
    expect(toy.applies(context("NaCl", "H2O"))).toBe(false);
  });

  it("declines a pair with a reason rather than staying silent", () => {
    // The gate is open (there is a hydrocarbon and there is oxygen in the set)
    // but this particular pair cannot react, and `chem predict` has to be able
    // to say so instead of dropping it.
    const verdict = toy.propose(context("CH4", "NaCl", "O2"));
    expect(verdict.proposals).toHaveLength(1);
    expect(verdict.declined).toEqual([
      { subject: "CH4 + NaCl", reason: "not a fuel and oxygen pair" },
      { subject: "NaCl + O2", reason: "not a fuel and oxygen pair" },
    ]);
  });
});

describe("candidate shape", () => {
  it("carries either a balanced equation or a skip reason, never neither", () => {
    const good: Candidate = {
      rule: "combustion",
      proposed: "CH4(g) + O2(g) -> CO2(g) + H2O(l)",
      reasoning: "a hydrocarbon burns in oxygen",
      balanced: balanceEquation(
        parseEquation("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)"),
      ),
    };
    expect(good.balanced).toBeDefined();
    expect(good.skipReason).toBeUndefined();

    // A rule that emits an equation the balancer rejects surfaces as a skip,
    // which is the whole reason the engine balances instead of trusting rules.
    const skipped: Candidate = {
      rule: "toy",
      proposed: "CH4(g) + O2(g) -> CO(g) + H2O2(l)",
      reasoning: "wrong on purpose",
      skipReason: "equation cannot be balanced: atom counts are inconsistent",
    };
    expect(skipped.balanced).toBeUndefined();
    expect(skipped.skipReason).toContain("cannot be balanced");
  });
});
