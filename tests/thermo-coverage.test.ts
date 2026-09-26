/**
 * The thermo-coverage cross-check: nothing in the curated tables may lean on a
 * ΔGf° the table does not actually hold — unless the gap is written down on
 * purpose.
 *
 * Every combination and decomposition row is balanced and priced. A missing
 * species is allowed only when it is one of the two documented gaps — HCl(g)
 * (the table prices hydrochloric acid only as (aq)) and NO(g) (nitrogen
 * monoxide has no entry at all) — so a typo in a phase ("MgO(aq)") or a
 * formula ("SO5") is caught here as an *undocumented* gap. The documentation
 * cannot rot either: each allowlisted gap must really be hit by some entry,
 * or the stale entry is removed.
 */
import { describe, expect, it } from "vitest";
import { balanceEquation } from "../src/core/balance.ts";
import { parseEquation } from "../src/core/equation.ts";
import { parseFormula } from "../src/core/formula.ts";
import { reactionGibbs } from "../src/thermo/thermo.ts";
import { formatEquation, type TermSpec } from "../src/rules/types.ts";
import { COMBINATION_ROWS, type CombinationRow } from "../src/rules/combination.ts";
import { SIMPLE_MATERIAL_ROWS, type SimpleMaterialRow } from "../src/rules/simpleMaterials.ts";
import { DECOMPOSITION_ROWS } from "../src/rules/decomposition.ts";

/**
 * Every ΔGf° gap the curated tables depend on, written down on purpose. Keys
 * are the friendly spellings; they are canonicalised below so a gap matches
 * the equation whatever Hill order did to it.
 */
const DOCUMENTED_GAPS: ReadonlyMap<string, string> = new Map([
  ["HCl(g)", "the table prices hydrochloric acid only as (aq), never (g)"],
  ["NO(g)", "nitrogen monoxide has no ΔGf° entry at all"],
]);

/** "HCl(g)" → "ClH(g)", the canonical spelling a parsed equation carries. */
function canonicalPhaseKey(friendly: string): string {
  const match = /\(([a-z]+)\)$/i.exec(friendly);
  const formula = match === null ? friendly : friendly.slice(0, match.index);
  const state = match === null ? "?" : match[1]!.toLowerCase();
  return `${parseFormula(formula).formula}(${state})`;
}

const DOCUMENTED_GAP_KEYS: ReadonlySet<string> = new Set([...DOCUMENTED_GAPS.keys()].map(canonicalPhaseKey));

/** The species the equation asked the table for but got no value back, keyed canonically. */
function missingKeys(gibbs: ReturnType<typeof reactionGibbs>): string[] {
  return gibbs.missing.map((m) => `${m.formula}(${m.state ?? "?"})`);
}

function checkEquation(equation: string, label: string): void {
  const gibbs = reactionGibbs(balanceEquation(parseEquation(equation)));
  for (const m of gibbs.missing) {
    const key = `${m.formula}(${m.state ?? "?"})`;
    expect(
      DOCUMENTED_GAP_KEYS.has(key),
      `${label}: ${m.reason} — an undocumented ΔGf° gap; add the species to the table or write the gap down by design`,
    ).toBe(true);
    hit.add(key);
  }
}

const hit = new Set<string>();

describe("every curated row prices or is a documented gap", () => {
  for (const row of COMBINATION_ROWS as readonly CombinationRow[]) {
    if (row.kind !== "product") continue;
    const label = `${row.reactants[0]!.formula} + ${row.reactants[1]!.formula} -> ${row.product.formula}`;
    it(`combination: ${label}`, () => {
      const equation = formatEquation(
        row.reactants.map((r): TermSpec => ({ formula: r.formula, state: r.state })),
        [{ formula: row.product.formula, state: row.product.state }],
      );
      checkEquation(equation, label);
    });
  }

  for (const row of SIMPLE_MATERIAL_ROWS as readonly SimpleMaterialRow[]) {
    if (row.kind !== "product") continue;
    const label = `${row.reactants[0]!.formula} + ${row.reactants[1]!.formula} -> ${row.product.formula}`;
    it(`simple materials: ${label}`, () => {
      const equation = formatEquation(
        row.reactants.map((r): TermSpec => ({ formula: r.formula, state: r.state })),
        [{ formula: row.product.formula, state: row.product.state }],
      );
      checkEquation(equation, label);
    });
  }

  for (const row of DECOMPOSITION_ROWS) {
    const label = `${row.source.formula} -> ${row.products.map((p) => p.formula).join(" + ")}`;
    it(`decomposition: ${label}`, () => {
      const equation = formatEquation(
        [{ formula: row.source.formula, state: row.source.state }],
        row.products.map((p): TermSpec => ({ formula: p.formula, state: p.state })),
      );
      checkEquation(equation, label);
    });
  }
});

describe("the documented gaps are real and current", () => {
  it("every allowlisted gap is actually hit by at least one entry", () => {
    for (const key of DOCUMENTED_GAP_KEYS) {
      expect(hit.has(key), `${key}: allowlisted but no curated row actually needs it`).toBe(true);
    }
  });

  it("no gap is hit that is not allowlisted", () => {
    for (const key of hit) {
      expect(DOCUMENTED_GAP_KEYS.has(key), `${key}: hit but not allowlisted`).toBe(true);
    }
  });
});