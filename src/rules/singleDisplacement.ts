/**
 * Single displacement: a metal displaces a metal below it in the reactivity
 * series out of one of its salts, or hydrogen out of an acid.
 *
 * **Both questions are answered by the series (T6), and the no's are the point.**
 * The positive cases — zinc pulling copper out of copper sulfate — are the easy
 * half; the rule's value is that it says the same thing about the negative one:
 * copper sitting below zinc means nothing happens, and the card says *why*.
 *
 * **The displaced metal's charge is written down, not derived.** Nothing in the
 * periodic table says zinc takes +2 and copper takes +2 while silver takes +1;
 * it is measured chemistry, exactly like the acid anions in T8, so it gets the
 * same treatment — a curated table, re-checked by the tests. `valence.ts` cannot
 * answer this (its first-positive rule would make the cupric cuprous and the
 * stannic stannous), which is why the rule does not ask it.
 *
 * **A metal with no place on the series gets the honest answer.** `series.ts`
 * returns `undefined` for tungsten, and `undefined` here becomes a decline — the
 * order against copper *cannot be judged* — never a verdict one way or the
 * other. The gate is wider than the series (any `isMetal` element), precisely
 * so those inputs reach the decline instead of vanishing into "no applicable
 * rule", which would look like a judgement gap that does not exist there.
 */
import { isMetal, isAlkaliMetal } from "../structure/valence.ts";
import type { PhysicalState } from "../core/equation.ts";
import { parseFormula } from "../core/formula.ts";
import { buildSalt, ionFromFormula, splitIons, type Ion } from "./ions.ts";
import { saltPhase } from "./solubility.ts";
import { ACID_ANIONS } from "./neutralization.ts";
import { displacesFromSalt, displacesHydrogen, type SeriesVerdict } from "./series.ts";
import {
  formatEquation,
  type Declined,
  type PredictContext,
  type Proposal,
  type ReactionRule,
  type SpeciesInput,
} from "./types.ts";

/**
 * The charge a series metal takes in the salts this rule writes.
 *
 * Classic school chemistry: ferrous salts, not ferric; cupric, not cuprous.
 * Tin and lead take the +2 of their common salts. The list is exactly the
 * series, and the tests re-derive the built salt against the thermo table so a
 * wrong entry cannot survive.
 */
export const DISPLACEMENT_CHARGE: ReadonlyMap<string, number> = new Map([
  ["K", 1], ["Na", 1], ["Li", 1], ["Ca", 2], ["Mg", 2], ["Al", 3],
  ["Zn", 2], ["Fe", 2], ["Sn", 2], ["Pb", 2], ["Cu", 2], ["Hg", 2],
  ["Ag", 1], ["Au", 3],
]);

const METAL: PhysicalState = "s";
const HYDROGEN: PhysicalState = "g";
const WATER: PhysicalState = "l";

/** The charge this metal's ion carries in a displacement salt, if the rule knows it. */
function chargeOf(metal: string): number | undefined {
  return DISPLACEMENT_CHARGE.get(metal);
}

/**
 * The metals cold water lets displace hydrogen. Curated, because it is measured
 * chemistry: magnesium is above hydrogen on the series and still will not react
 * with cold water — it needs steam. Everything above hydrogen that is not on
 * this list gets told exactly that.
 */
const COLD_WATER: ReadonlySet<string> = new Set(["K", "Na", "Li", "Ca"]);

/** The ion a bare metal becomes, e.g. "Zn" → Zn²⁺. */
function metalIon(metal: string): Ion | undefined {
  const charge = chargeOf(metal);
  return charge === undefined ? undefined : ionFromFormula(`${metal}^${charge}+`);
}

/**
 * The metal a species is, on or off the series.
 *
 * On the series it can displace; off it, the decline is that its position is
 * unknown. Bare hydrogen is a non-metal to `isMetal` and never reaches here.
 */
function metalOf(species: SpeciesInput): string | undefined {
  const { elements } = parseFormula(species.formula);
  if (elements.size !== 1) return undefined;
  const symbol = [...elements.keys()][0]!;
  return isMetal(symbol) ? symbol : undefined;
}

/** The cation a salt is built around, e.g. "Cu" for CuSO₄, "NH4" for NH₄Cl. */
function saltCation(salt: SpeciesInput): string | undefined {
  return splitIons(salt)?.cations[0]?.formula;
}

/** A decline for a metal the series has no word for. */
function untabled(origin: string, metal: string, partner: string, outOf: string): Declined {
  return {
    subject: origin,
    reason: `${metal} has no place in the reactivity series, so whether it displaces anything from the ${outOf} ${partner} cannot be judged`,
  };
}

/** Is this species the salt shape of the rule — not an acid, and not a base? */
function isSalt(species: SpeciesInput): boolean {
  // A hydroxide base splits into ions too (NaOH → Na⁺ + OH⁻), but it is not a
  // displacement partner: the series talk about it would be noise next to the
  // real amphoteric chemistry, which this rule does not write.
  if (species.classification.classes.includes("base")) return false;
  return splitIons(species) !== undefined;
}

/** Is this species the acid shape of the rule? */
function isAcid(species: SpeciesInput): boolean {
  return species.classification.classes.includes("acid");
}

/** The anion an acid leaves, from T8's curated table. */
function acidAnion(acid: SpeciesInput): Ion | undefined {
  const written = ACID_ANIONS.get(acid.formula);
  return written === undefined ? undefined : ionFromFormula(written);
}

/**
 * Metal + (salt | acid | cold water) → new salt + (metal | H₂).
 *
 * The equation is written with no coefficients; the engine balances it. The
 * proposal's products are the salt (or hydroxide) and the freed metal (or
 * hydrogen), in the order a textbook prints them.
 */
export const singleDisplacement: ReactionRule = {
  name: "singleDisplacement",
  description:
    "a metal displaces a metal below it out of a salt, or hydrogen out of an acid or cold water (reactivity series)",
  applies: (ctx: PredictContext) => ctx.species.some((s) => metalOf(s) !== undefined),
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];
    const partners = ctx.species.filter((s) => isSalt(s) || isAcid(s));
    const water = ctx.species.find((s) => s.formula === "H2O");
    const hydroxideIon = ionFromFormula("OH-")!;

    for (const species of ctx.species) {
      const metal = metalOf(species);
      if (metal === undefined) continue;
      const origin = species.input;

      // Metal + cold water → hydroxide + H2, or the honest no: most metals above
      // hydrogen still need steam, which this rule does not write.
      if (water !== undefined) {
        if (COLD_WATER.has(metal)) {
          const hydroxide = buildSalt(metalIon(metal)!, hydroxideIon);
          proposals.push({
            equation: formatEquation(
              [
                { formula: origin, state: species.state ?? METAL },
                { formula: "H2O", state: WATER },
              ],
              [
                { formula: hydroxide, state: saltPhase(hydroxide) },
                { formula: "H2", state: HYDROGEN },
              ],
            ),
            reasoning: `${metal} sits above hydrogen, and cold water lets it through — the products are ${hydroxide} and H2`,
          });
        } else {
          const verdict = displacesHydrogen(metal);
          if (verdict === undefined) {
            declined.push({
              subject: origin,
              reason: `${metal} has no place in the reactivity series, so whether it displaces hydrogen from water cannot be judged`,
            });
          } else if (verdict.displaces) {
            declined.push({
              subject: `${metal} H2O`,
              reason: `${metal} is above hydrogen, but cold water reacts only with the alkali metals and calcium — ${metal} needs steam, which this rule does not write`,
            });
          } else {
            declined.push({
              subject: `${metal} H2O`,
              reason: `${metal} sits below hydrogen in the reactivity series, so it does not displace H2 from water either`,
            });
          }
        }
      }

      if (partners.length === 0 && water === undefined) {
        declined.push({
          subject: origin,
          reason: `single displacement needs a salt, an acid or water for ${metal} to pull a metal or hydrogen out of, and none was given`,
        });
        continue;
      }

      for (const partner of partners) {
        if (isAcid(partner)) {
          // Metal + acid → salt + H2, gated by the hydrogen line.
          const verdict = displacesHydrogen(metal);
          if (verdict === undefined) {
            declined.push(untabled(origin, metal, partner.input, "acid"));
            continue;
          }
          if (!verdict.displaces) {
            declined.push({ subject: `${metal} ${partner.input}`, reason: verdict.reason });
            continue;
          }
          const anion = acidAnion(partner);
          if (anion === undefined) {
            declined.push({
              subject: `${metal} ${partner.input}`,
              reason: `no anion is known for ${partner.input}, so the salt ${metal} would make cannot be written`,
            });
            continue;
          }
          const ion = metalIon(metal)!;
          const salt = buildSalt(ion, anion);
          proposals.push({
            equation: formatEquation(
              [
                { formula: origin, state: species.state ?? METAL },
                { formula: partner.input, state: partner.state ?? "aq" },
              ],
              [
                { formula: salt, state: saltPhase(salt) },
                { formula: "H2", state: HYDROGEN },
              ],
            ),
            reasoning: `${verdict.reason} — the products are ${salt} and H2`,
          });
          continue;
        }

        // Metal + salt → new salt + the displaced metal, gated by the series.
        const cation = saltCation(partner);
        if (cation === undefined) continue;
        const verdict = displacesFromSalt(metal, cation);
        if (verdict === undefined) {
          declined.push(untabled(origin, metal, partner.input, "salt"));
          continue;
        }
        if (!verdict.displaces) {
          declined.push({ subject: `${metal} ${partner.input}`, reason: verdict.reason });
          continue;
        }
        const anion = splitIons(partner)!.anions[0]!;
        const ion = metalIon(metal);
        if (ion === undefined) {
          declined.push({
            subject: `${metal} ${partner.input}`,
            reason: `no common ion charge is known for ${metal}, so the salt it would make cannot be written`,
          });
          continue;
        }
        const salt = buildSalt(ion, anion);
        const alkaliNote = isAlkaliMetal(metal)
          ? " (an alkali metal also reacts with the water itself, so only the displacement is priced)"
          : "";
        proposals.push({
          equation: formatEquation(
            [
              { formula: origin, state: species.state ?? METAL },
              { formula: partner.input, state: partner.state ?? "aq" },
            ],
            [
              { formula: salt, state: saltPhase(salt) },
              { formula: cation, state: METAL },
            ],
          ),
          reasoning: `${verdict.reason} — the products are ${salt} and ${cation}${alkaliNote}`,
        });
        continue;
      }
    }

    return { proposals, declined: unique(declined) };
  },
};

/** Drop repeated declines — two identical metals would otherwise repeat. */
function unique(declined: Declined[]): Declined[] {
  const seen = new Set<string>();
  const out: Declined[] = [];
  for (const entry of declined) {
    const key = `${entry.subject}\u0000${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}