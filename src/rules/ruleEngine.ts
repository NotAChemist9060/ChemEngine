/**
 * The rule engine: every rule fires, and the engine keeps only what survives.
 *
 * Rules are trusted to propose chemistry, never to balance it. Each proposal is
 * run through the balancer here, and the outcome is always visible: a balanced
 * `Candidate`, or a `Candidate` with a `skipReason` — an equation that would
 * not balance is surfaced as a bug, never papered over. If two rules propose
 * the identical reaction (same species, same states, same coefficients), only
 * the first keeps its card; the later one is counted, so the merge is
 * auditable.
 *
 * Declines travel with the result too. `chem predict "CH4"` answers *nothing
 * happens* by reporting the rules' reasons — "combustion needs O2", "no
 * decomposition in the curated table for CH4" — instead of printing an empty
 * list that reads as a confident no.
 *
 * `predict` runs the six §5 rules in one fixed order. The order only matters
 * when two of them propose the same equation, and first-wins is as good as any
 * choice; it is documented so the attribution cannot drift.
 */
import type { BalancedEquation } from "../core/balance.ts";
import { balanceEquation } from "../core/balance.ts";
import { parseEquation, type StoichTerm } from "../core/equation.ts";
import {
  parseSpeciesInput,
  uniqueDeclines,
  type Candidate,
  type Declined,
  type PredictContext,
  type Proposal,
  type ReactionRule,
  type SpeciesInput,
} from "./types.ts";
import { combustion } from "./combustion.ts";
import { neutralization } from "./neutralization.ts";
import { singleDisplacement } from "./singleDisplacement.ts";
import { doubleDisplacement } from "./doubleDisplacement.ts";
import { combination } from "./combination.ts";
import { decomposition } from "./decomposition.ts";

/** The six §5 rules, in the order they fire. */
export const ALL_RULES: readonly ReactionRule[] = [
  combustion,
  neutralization,
  singleDisplacement,
  doubleDisplacement,
  combination,
  decomposition,
];

/** What `predict` came back with: the balanced chemistry, and why nothing else ran. */
export interface PredictionResult {
  /** What was asked, exactly as given. */
  input: string;
  /** The species, in the order they were named. */
  species: readonly SpeciesInput[];
  /**
   * Every proposal that balanced, rule-attributed, deduped, in rule order.
   * A `Candidate` always carries either `balanced` or `skipReason` — never both,
   * never neither.
   */
  candidates: Candidate[];
  /** Proposals dropped because an earlier rule proposed the identical reaction. */
  duplicatesDropped: number;
  /** Everything the rules turned down, deduped, in rule order. */
  declined: Declined[];
}

/** Build the engine's context from the raw input line. */
export function contextOf(input: string): PredictContext {
  const tokens = input.trim().split(/\s+/).filter((token) => token.length > 0);
  return { input: tokens.join(" "), species: tokens.map(parseSpeciesInput) };
}

/**
 * Run the rules and turn every proposal into a balanced candidate or a visible
 * skip. `rules` is overridable so the engine's own tests can feed it a rule
 * that proposes an unbalanced equation — the path the CLI must survive.
 */
export function predict(input: string, rules: readonly ReactionRule[] = ALL_RULES): PredictionResult {
  const ctx = contextOf(input);
  const candidates: Candidate[] = [];
  const declined: Declined[] = [];
  let duplicatesDropped = 0;
  const seen = new Set<string>();

  for (const rule of rules) {
    if (!rule.applies(ctx)) continue;
    const verdict = rule.propose(ctx);
    declined.push(...verdict.declined);
    for (const proposal of verdict.proposals) {
      const candidate = candidateFor(rule, proposal);
      if (candidate.balanced === undefined) {
        // A skip is far too interesting to dedupe away: show it, rule-attributed.
        candidates.push(candidate);
        continue;
      }
      const key = equationKey(candidate.balanced);
      if (seen.has(key)) {
        duplicatesDropped++;
        continue;
      }
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return {
    input: ctx.input,
    species: ctx.species,
    candidates,
    duplicatesDropped,
    declined: uniqueDeclines(declined),
  };
}

/** Balance one proposal; an impossible equation becomes a skip, not a crash. */
function candidateFor(rule: ReactionRule, proposal: Proposal): Candidate {
  try {
    const balanced = balanceEquation(parseEquation(proposal.equation));
    return { rule: rule.name, proposed: proposal.equation, reasoning: proposal.reasoning, balanced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { rule: rule.name, proposed: proposal.equation, reasoning: proposal.reasoning, skipReason: message };
  }
}

/**
 * The identity of a balanced reaction: canonical formulas, states and
 * coefficients on both sides. Two proposals that land on the same integers are
 * the same reaction whoever wrote them.
 */
function equationKey(balanced: BalancedEquation): string {
  const { equation, coefficients } = balanced;
  const term = (species: StoichTerm, index: number): string =>
    `${species.formula}(${species.state ?? "*"})×${coefficients[index]}`;
  const side = (list: StoichTerm[], start: number): string =>
    list.map((species, i) => term(species, start + i)).join("+");
  return `${side(equation.reactants, 0)}→${side(equation.products, equation.reactants.length)}`;
}