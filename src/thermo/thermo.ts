/**
 * The reaction Gibbs energy: ΔG_rxn° = Σ n·ΔGf°(products) − Σ n·ΔGf°(reactants).
 *
 * Three things make this more than a subtraction.
 *
 * **Phases decide the answer.** Combustion of methane is −817.9 kJ/mol when the
 * water comes out as a liquid and −800.8 when it comes out as vapour, an 8.6
 * kJ/mol swing per water molecule. A term without a state is therefore not
 * assumed to be any phase: the table is asked, and if it cannot answer (water
 * has three phases and the equation said none) the reaction comes back
 * `unknown` with the reason, rather than a number that depends on a guess.
 *
 * **An unknown species is never a zero.** A missing ΔGf° means no total at all,
 * not a total with a hole in it: `known: false`, the list of what is missing,
 * and the reason for each. Subtracting nothing would quietly rank a reaction we
 * know nothing about alongside one we measured (§3).
 *
 * **The arithmetic is exact.** Coefficients come from the balancer as integers
 * and the table's values are tabulated decimals, so each value is read through
 * its decimal text into a `Rational` and the sum is accumulated in exact
 * arithmetic. −394.36 + 2 × −237.13 + 50.72 is −817.90 by construction, not by
 * luck of the binary representation.
 */
import type { BalancedEquation } from "../core/balance.ts";
import type { PhysicalState } from "../core/equation.ts";
import { ratAdd, ratFromDecimal, ratMul, ratToNumber, type Rational } from "../util/rational.ts";
import { dGfOf, THERMO_TEMPERATURE } from "./table.ts";

/** One species as it entered the sum. */
export interface ReactionTerm {
  /** Formula as written in the equation. */
  formula: string;
  /** The phase the value came from; absent when the table could not choose one. */
  state?: PhysicalState;
  /** +1 for a product, −1 for a reactant. */
  sign: 1 | -1;
  /** Stoichiometric coefficient from the balanced equation. */
  coefficient: number;
  /** ΔGf° in kJ/mol at 298.15 K; absent when the table has no value. */
  dGfKj?: number;
  /** coefficient × sign × ΔGf°, in kJ/mol. */
  contributionKj?: number;
  /** Why there is no value, when there is none. */
  reason?: string;
}

/** A species that stopped the sum, and why. */
export interface MissingSpecies {
  formula: string;
  /** The phase the equation asked for, if it named one. */
  state?: PhysicalState;
  reason: string;
}

export interface ReactionGibbs {
  /** True when every term had a value and a total is meaningful. */
  known: boolean;
  /** ΔG_rxn° in kJ/mol for the reaction **as balanced**, exact. */
  dGrxn?: Rational;
  /** The same total as a plain number, for display and ranking. */
  dGrxnKj?: number;
  /** Species with no ΔGf°, empty when `known`. */
  missing: MissingSpecies[];
  terms: ReactionTerm[];
  /** The only temperature these values are valid at. */
  temperature: number;
}

/**
 * ΔG_rxn° for a balanced equation.
 *
 * The total is for the equation in its balanced (smallest-integer) form, so
 * `H2 + O2 -> H2O` reads 2 H2 + O2 -> 2 H2O and reports twice the per-mole
 * figure. Print the balanced equation next to the number and the two agree.
 */
export function reactionGibbs(balanced: BalancedEquation): ReactionGibbs {
  const { equation, coefficients } = balanced;
  const species = [...equation.reactants, ...equation.products];
  const terms: ReactionTerm[] = [];
  const missing: MissingSpecies[] = [];
  let total = ratFromDecimal("0");
  let known = true;

  species.forEach((species_, index) => {
    const coefficient = coefficients[index] ?? 1;
    const sign: 1 | -1 = index < equation.reactants.length ? -1 : 1;
    const lookup = dGfOf(species_.formula, species_.state);
    const term: ReactionTerm = { formula: species_.formula, sign, coefficient };
    if (species_.state !== undefined) term.state = species_.state;

    if (!lookup.known) {
      term.reason = lookup.reason;
      known = false;
      const gap: MissingSpecies = { formula: species_.formula, reason: lookup.reason };
      if (species_.state !== undefined) gap.state = species_.state;
      missing.push(gap);
    } else {
      term.dGfKj = lookup.kj;
      // Report the phase actually used, whether the equation named it or the
      // table could decide from a species that has only one phase.
      term.state = species_.state ?? lookup.state;
      // The sign rides in the contribution: a reactant's ΔGf° is already
      // negated by the coefficient factor, so the sum only ever adds.
      const contribution = ratMul(ratFromDecimal(`${sign * coefficient}`), kjToRational(lookup.kj));
      term.contributionKj = ratToNumber(contribution);
      total = ratAdd(total, contribution);
    }
    terms.push(term);
  });

  const result: ReactionGibbs = { known, missing, terms, temperature: THERMO_TEMPERATURE };
  if (known) {
    result.dGrxn = total;
    result.dGrxnKj = ratToNumber(total);
  }
  return result;
}

/**
 * A tabulated ΔGf° as an exact rational, read through its decimal text.
 *
 * Going via the text rather than the binary double is what makes the sum exact:
 * the table holds two-decimal values, and "-237.13" is 23713/100, not the
 * nearest representable double to it. `toFixed(4)` only clears noise beyond the
 * precision a table of formation energies is quoted to.
 */
function kjToRational(kj: number): Rational {
  return ratFromDecimal(kj.toFixed(4));
}
