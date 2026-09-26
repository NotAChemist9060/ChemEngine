/**
 * Feasibility: what a candidate's ΔG_rxn° *says*, and the order to read it in.
 *
 * **Verdicts.** Spontaneous (ΔG ≤ −20 kJ/mol, the reaction runs as written),
 * nonspontaneous (ΔG ≥ +20, it needs energy input), and marginal in between —
 * the sign is known but so close to zero that the direction can flip with
 * concentrations or conditions, which is a different, quieter answer. A
 * reaction the table cannot price gets its own verdict, `unknown`, and is
 * never folded into a guessed sign.
 *
 * **Ranking.** Candidates read most-favourable-first: known ΔG ascending, so
 * the most negative lands on top, and every unknown-ΔG candidate after all of
 * them, still labelled. A `Candidate` with a `skipReason` is not a reaction
 * (an equation that would not balance is a surfaced rule bug) and never
 * appears here at all.
 *
 * **One explanation per candidate.** Each card carries a sentence that states
 * the verdict *and* the number (or the missing ΔGf°) that backs it, so the
 * two can never disagree on the card.
 */
import type { BalancedEquation } from "../core/balance.ts";
import { reactionGibbs, type MissingSpecies, type ReactionGibbs } from "./thermo.ts";
import type { Candidate } from "../rules/types.ts";

export type Verdict = "spontaneous" | "marginal" | "nonspontaneous" | "unknown";

/**
 * The band either side of zero inside which a sign is too near equilibrium to
 * trust: concentrations can swing a reaction with |ΔG| under this in either
 * direction. 20 kJ/mol is the usual rule-of-thumb value.
 */
export const MARGINAL_BAND_KJ = 20;

/** One candidate, priced and judged. */
export interface Feasibility {
  /** The rule that proposed it. */
  rule: string;
  /** The equation as the rule wrote it, phases included. */
  proposed: string;
  /** The balanced equation that was priced. */
  balanced: BalancedEquation;
  /** The rule's one-line why. */
  reasoning: string;
  /** ΔG_rxn°, when every term priced; absent exactly when `verdict` is `unknown`. */
  dGrxnKj?: number;
  verdict: Verdict;
  /** The one line that states the verdict and the value that backs it. */
  explanation: string;
  /** The species that stopped the price, when it stopped. */
  missing: MissingSpecies[];
}

export function verdictOf(gibbs: ReactionGibbs): Verdict {
  if (!gibbs.known) return "unknown";
  const dGrxnKj = gibbs.dGrxnKj!;
  if (dGrxnKj <= -MARGINAL_BAND_KJ) return "spontaneous";
  if (dGrxnKj >= MARGINAL_BAND_KJ) return "nonspontaneous";
  return "marginal";
}

/** The one-line backing for a verdict — the number, or the gap that stopped it. */
export function explain(gibbs: ReactionGibbs): string {
  if (!gibbs.known) {
    const gaps = gibbs.missing.map((m) => m.reason).join("; ");
    return `cannot be judged — ${gaps}, so the ΔG total is unknown`;
  }
  const kj = gibbs.dGrxnKj!.toFixed(2);
  const at = `at ${gibbs.temperature} K`;
  switch (verdictOf(gibbs)) {
    case "spontaneous":
      return `spontaneous (ΔG° = ${kj} kJ/mol ${at}) — this reaction runs as written`;
    case "nonspontaneous":
      return `nonspontaneous (ΔG° = ${kj} kJ/mol ${at}) — it needs energy input to run as written`;
    case "marginal":
      return `marginal (ΔG° = ${kj} kJ/mol ${at}) — close enough to zero that the direction can flip with conditions`;
    case "unknown":
      // Unreachable: `unknown` requires an unpriced reaction, and the return
      // above already handled those. Kept so the verdict switch is total.
      return "cannot be judged — the reaction priced but the verdict is unknown";
  }
}

/** Price and judge one balanced candidate. */
export function feasibilityOf(candidate: Candidate & { balanced: BalancedEquation }): Feasibility {
  const gibbs = reactionGibbs(candidate.balanced);
  const feasibility: Feasibility = {
    rule: candidate.rule,
    proposed: candidate.proposed,
    balanced: candidate.balanced,
    reasoning: candidate.reasoning,
    verdict: verdictOf(gibbs),
    explanation: explain(gibbs),
    missing: gibbs.missing,
  };
  if (gibbs.known) feasibility.dGrxnKj = gibbs.dGrxnKj!;
  return feasibility;
}

/**
 * Rank candidates most-favourable-first: known ΔG ascending, then every
 * unknown-ΔG candidate after them in their original order. Candidates without
 * a balanced equation (skipReason carries them) are not reactions and are
 * dropped here.
 */
export function rankFeasibility(candidates: readonly Candidate[]): Feasibility[] {
  const priced: Array<Candidate & { balanced: BalancedEquation }> = [];
  for (const candidate of candidates) {
    if (candidate.balanced !== undefined) priced.push(candidate as Candidate & { balanced: BalancedEquation });
  }
  const judged = priced.map(feasibilityOf);
  return judged.sort((a, b) => {
    const aKnown = a.dGrxnKj !== undefined;
    const bKnown = b.dGrxnKj !== undefined;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (aKnown) return a.dGrxnKj! - b.dGrxnKj!;
    return 0;
  });
}