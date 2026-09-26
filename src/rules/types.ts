/**
 * The vocabulary every rule speaks.
 *
 * A rule is declarative in two beats. `applies(ctx)` is a cheap class-level
 * question — "is there a hydrocarbon and an O2 in here at all?" — and
 * `propose(ctx)` returns what the rule would actually do, with a reason for
 * every proposal and a reason for every pair it turned down. Keeping those two
 * beats apart is what lets `chem predict` say *nothing happens and here is
 * why* instead of printing an empty list that reads as a confident no (§3, §7).
 *
 * **Rules propose equations, the engine balances them.** A rule writes what it
 * believes happens; `ruleEngine` runs it through the balancer and either keeps
 * the balanced result or records a `skipReason`. A rule that emits unbalanced
 * coefficients therefore shows up as a visible skip rather than as a wrong
 * equation, which is the only way a generated chemistry layer stays auditable.
 *
 * **Every term carries a phase.** The phases are not decoration: methane
 * combustion is −817.9 kJ/mol with liquid water and −800.8 with vapour, and
 * `StoichTerm.state` already exists to hold them. A rule that cannot know the
 * phase should say so (`state: undefined` in the term) rather than pick one —
 * the table reports that as an unknown instead of a number nobody can defend.
 */
import { classify } from "../knowledge/classify.ts";
import { buildStructure } from "../structure/fromFormula.ts";
import type { BalancedEquation } from "../core/balance.ts";
import type { PhysicalState } from "../core/equation.ts";
import type { Classification } from "../knowledge/classify.ts";
import type { StructureBuild } from "../structure/fromFormula.ts";

/** One species the user named, with everything a rule is allowed to rely on. */
export interface SpeciesInput {
  /** What the user typed, e.g. "Ca(OH)2". */
  input: string;
  /** Canonical Hill-order formula, e.g. "CaH2O2". */
  formula: string;
  /** What the classifier says it is, with its evidence. */
  classification: Classification;
  /** The graph, when one could be built. `molecule: null` means empirical only. */
  structure: StructureBuild;
  /** The phase the user typed, e.g. "(aq)". Absent when they typed none. */
  state?: PhysicalState;
}

/** Everything a rule is given: what was asked, and what was named. */
export interface PredictContext {
  /** The species as given on the command line, e.g. "CH4 O2". */
  input: string;
  /** The species, in the order they were named. */
  species: readonly SpeciesInput[];
}

/** A species reference in a proposed equation. */
export interface TermSpec {
  formula: string;
  /**
   * The phase to write. Explicitly allowed to be `undefined`: a rule that
   * cannot know the phase writes none, and the thermo lookup then reports an
   * unknown rather than the engine picking a phase on the rule's behalf.
   */
  state?: PhysicalState | undefined;
  /** Written for readability; the engine recomputes it when balancing. */
  coefficient?: number;
}

/** One reaction a rule stands behind. */
export interface Proposal {
  /** The reaction as the rule writes it, phases included. */
  equation: string;
  /** One line of why, for the card. */
  reasoning: string;
}

/** A pair a rule looked at and declined, with the reason it declined. */
export interface Declined {
  /** What was considered, e.g. "Cu(s) + ZnSO4(aq)". */
  subject: string;
  /** Why nothing happens, e.g. "Cu sits below Zn in the reactivity series". */
  reason: string;
}

/** What a rule has to say: the proposals, and everything it turned down. */
export interface RuleVerdict {
  proposals: Proposal[];
  declined: Declined[];
}

/** A rule: an identity, a cheap gate, and the proposals behind it. */
export interface ReactionRule {
  /** Stable id, used in output and for deduping: "combustion", "neutralization". */
  name: string;
  /** One line for `chem rules` and for the card's attribution. */
  description: string;
  /**
   * The cheap class-level gate. `false` means "this rule has nothing to say
   * about this set of species", which is different from saying no to a specific
   * pair — a declined pair comes back in `propose().declined` with a reason.
   */
  applies(ctx: PredictContext): boolean;
  propose(ctx: PredictContext): RuleVerdict;
}

/** A proposal after the engine has balanced it, or after refusing to. */
export interface Candidate {
  /** The rule that proposed it. */
  rule: string;
  /** The rule's own equation text, phases included, as proposed. */
  proposed: string;
  /** The rule's one-line reasoning. */
  reasoning: string;
  /** The balanced equation. Absent exactly when `skipReason` is present. */
  balanced?: BalancedEquation;
  /**
   * Why there is no balanced equation. Only ever a rule bug (an unbalanced or
   * unparseable proposal) — surfaced rather than papered over, because a
   * quietly wrong equation is worse than a missing one.
   */
  skipReason?: string;
}

/**
 * Build a `SpeciesInput` from one token the user typed.
 *
 * A trailing `(s|l|g|aq)` is taken off and kept as the phase, so a species
 * carries its state through to the proposal. Throws for a token that is not a
 * formula at all: that is a user error the CLI turns into a `UserError`, not a
 * chemistry unknown a rule should have to survive.
 */
export function parseSpeciesInput(token: string): SpeciesInput {
  const input = token.trim();
  const match = /\((s|l|g|aq)\)$/i.exec(input);
  const state = match?.[1]?.toLowerCase() as PhysicalState | undefined;
  const formula = (match === null ? input : input.slice(0, match.index)).trim();
  if (formula.length === 0) {
    throw new Error(`species '${token}': nothing but a phase`);
  }
  const classification = classify(formula);
  const species: SpeciesInput = {
    input: formula,
    formula: classification.formula,
    classification,
    structure: buildStructure(formula),
  };
  if (state !== undefined) species.state = state;
  return species;
}

/** Every unordered pair of named species, in the order the user gave them. */
export function speciesPairs(ctx: PredictContext): Array<[SpeciesInput, SpeciesInput]> {
  const pairs: Array<[SpeciesInput, SpeciesInput]> = [];
  for (let i = 0; i < ctx.species.length; i++) {
    for (let j = i + 1; j < ctx.species.length; j++) {
      pairs.push([ctx.species[i]!, ctx.species[j]!]);
    }
  }
  return pairs;
}

/** The first named species that satisfies a test, or `undefined`. */
export function findSpecies(
  ctx: PredictContext,
  test: (species: SpeciesInput) => boolean,
): SpeciesInput | undefined {
  return ctx.species.find(test);
}

/** One term of a proposed equation: coefficient (when not 1), formula, phase. */
export function formatTerm(spec: TermSpec): string {
  const coefficient = spec.coefficient ?? 1;
  const prefix = coefficient === 1 ? "" : `${coefficient}`;
  return `${prefix}${spec.formula}${spec.state === undefined ? "" : `(${spec.state})`}`;
}

/** A whole proposed equation, e.g. "CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)". */
export function formatEquation(reactants: readonly TermSpec[], products: readonly TermSpec[]): string {
  const left = reactants.map(formatTerm).join(" + ");
  const right = products.map(formatTerm).join(" + ");
  return `${left} -> ${right}`;
}
