/**
 * Double displacement (metathesis): two salts swap their ions, and the swap is
 * driven when one of the products is insoluble — it falls out of solution and
 * the other salt is left behind.
 *
 * **The plan's shape is salt + salt, and no more.** Acids meet bases in T8 and
 * metals meet salts in T9, so a partner here is a species the classifier calls
 * a salt *and* the ion reader can split into one cation kind and one anion kind.
 * Bases, hydrates and oxides are other rules' business, and a two-metal salt
 * like KAl(SO₄)₂ cannot be read into a single swap at all — the card says so.
 *
 * **The no's matter as much as the yes's, and they must never overclaim.** Two
 * soluble salts that trade ions (NaCl + KNO₃) genuinely do nothing, and the
 * card says that, naming the dissolved products. Two salts that share an ion
 * (AgNO₃ + NaNO₃) hand back what they started with. But when the solubility
 * rules cannot judge one of the products — an ion they have no rule for — the
 * card says it cannot judge, instead of pretending both stay dissolved.
 */
import type { PhysicalState } from "../core/equation.ts";
import { buildSalt, splitIons, type Ion } from "./ions.ts";
import { saltPhase, solubilityGap, solubilityOf } from "./solubility.ts";
import {
  formatEquation,
  parseSpeciesInput,
  uniqueDeclines,
  type Declined,
  type PredictContext,
  type Proposal,
  type ReactionRule,
  type SpeciesInput,
} from "./types.ts";

const DISSOLVED: PhysicalState = "aq";

/** The one cation kind and one anion kind of a salt, when it has exactly those. */
function typesOf(species: SpeciesInput): { cat: Ion; an: Ion } | undefined {
  const ions = splitIons(species);
  if (ions === undefined || ions.cations.length === 0 || ions.anions.length === 0) return undefined;
  const cat = ions.cations[0]!;
  const an = ions.anions[0]!;
  // FeCl3 reads as Fe³⁺ + 3Cl⁻ — one kind each, fine. KAl(SO4)2 reads as
  // K⁺ + Al³⁺ + 2SO₄²⁻ — two cation kinds, no single swap to write.
  if (!ions.cations.every((i) => i.formula === cat.formula)) return undefined;
  if (!ions.anions.every((i) => i.formula === an.formula)) return undefined;
  return { cat, an };
}

/** Why a salt that splits messily cannot take part in a swap. */
function unreadableReason(species: SpeciesInput): string {
  const ions = splitIons(species);
  const catKinds = new Set(ions?.cations.map((i) => i.formula) ?? []);
  const anKinds = new Set(ions?.anions.map((i) => i.formula) ?? []);
  if (catKinds.size > 1) {
    return `the ion reader splits ${species.input} into more than one cation kind (${[...catKinds].join(", ")}), so it cannot take part in an ion swap`;
  }
  if (anKinds.size > 1) {
    return `the ion reader splits ${species.input} into more than one anion kind (${[...anKinds].join(", ")}), so it cannot take part in an ion swap`;
  }
  return `the ion reader cannot see ${species.input} as one cation and one anion, so it cannot take part in an ion swap`;
}

/**
 * Two salts swap ions; the swap is a reaction only when a product precipitates.
 *
 * The equation is written without coefficients; the engine balances it. When
 * exactly one product is insoluble it is written first, so the card leads with
 * the thing that fell out.
 */
export const doubleDisplacement: ReactionRule = {
  name: "doubleDisplacement",
  description:
    "two salts swap their ions; a product that cannot dissolve falls out and drives the reaction (solubility rules)",
  applies: (ctx: PredictContext) => ctx.species.some((s) => s.classification.primary === "salt"),
  propose: (ctx: PredictContext): { proposals: Proposal[]; declined: Declined[] } => {
    const proposals: Proposal[] = [];
    const declined: Declined[] = [];
    const salts = ctx.species.filter((s) => s.classification.primary === "salt");

    const readable = new Map<SpeciesInput, { cat: Ion; an: Ion }>();
    for (const salt of salts) {
      const types = typesOf(salt);
      if (types === undefined) {
        declined.push({ subject: salt.input, reason: unreadableReason(salt) });
      } else {
        readable.set(salt, types);
      }
    }
    const partners = [...readable.keys()];

    if (partners.length === 0) {
      return { proposals, declined: uniqueDeclines(declined) };
    }
    if (partners.length === 1) {
      declined.push({
        subject: partners[0]!.input,
        reason: salts.length === 1
          ? `double displacement needs a second salt to swap ions with ${partners[0]!.input}, and none was given`
          : `double displacement needs two salts that split cleanly into ions, and ${partners[0]!.input} is the only one here`,
      });
      return { proposals, declined: uniqueDeclines(declined) };
    }

    for (let i = 0; i < partners.length; i++) {
      for (let j = i + 1; j < partners.length; j++) {
        const a = partners[i]!;
        const b = partners[j]!;
        const { cat: catA, an: anA } = readable.get(a)!;
        const { cat: catB, an: anB } = readable.get(b)!;
        const subject = `${a.input} ${b.input}`;

        // Both reactants must be able to sit in solution together.
        const solA = solubilityOf(a)?.solubility;
        const solB = solubilityOf(b)?.solubility;
        if (solA === "insoluble" || solB === "insoluble") {
          const solid = solA === "insoluble" ? a : b;
          const other = solid === a ? b : a;
          declined.push({
            subject,
            reason: `double displacement needs both salts dissolved, and ${solid.input} does not dissolve on the solubility rules — it cannot meet ${other.input} in solution`,
          });
          continue;
        }

        const saltA = buildSalt(catA, anB);
        const saltB = buildSalt(catB, anA);
        const vA = solubilityOf(parseSpeciesInput(saltA))?.solubility;
        const vB = solubilityOf(parseSpeciesInput(saltB))?.solubility;

        if (vA === "insoluble" || vB === "insoluble") {
          const precipitates = [
            ...(vA === "insoluble" ? [saltA] : []),
            ...(vB === "insoluble" ? [saltB] : []),
          ];
          const swap = `${catA.formula} pairs with ${anB.formula}, and ${catB.formula} with ${anA.formula}`;
          // Lead with the precipitate, so the card shows what drives the swap.
          const first = precipitates.includes(saltA) ? saltA : saltB;
          const second = first === saltA ? saltB : saltA;
          proposals.push({
            equation: formatEquation(
              [
                { formula: a.input, state: a.state ?? DISSOLVED },
                { formula: b.input, state: b.state ?? DISSOLVED },
              ],
              [
                { formula: first, state: saltPhase(first) },
                { formula: second, state: saltPhase(second) },
              ],
            ),
            reasoning: precipitates.length === 2
              ? `the ions swap — ${swap} — and both ${saltA} and ${saltB} are insoluble, so they fall out of solution and drive the reaction`
              : `the ions swap — ${swap} — ${precipitates[0]} is insoluble, so it falls out of solution and drives the reaction`,
          });
          continue;
        }

        if (vA === undefined || vB === undefined) {
          // The driving force is a precipitate, and the rules cannot say whether
          // there is one — that has to be named, not papered over.
          const unjudged = vA === undefined ? saltA : saltB;
          declined.push({
            subject,
            reason: `the swap would make ${saltA} and ${saltB}; a double displacement is driven only when one falls out of solution, and the rules cannot judge ${unjudged} — ${solubilityGap(parseSpeciesInput(unjudged))}`,
          });
          continue;
        }

        // Both products are judged soluble — including the case where the two
        // salts share an ion and the swap hands back what was handed in. The
        // input spellings are compared, not the Hill-order formulas: buildSalt
        // writes "NaCl" where the reader's canonical form would be "ClNa".
        const same = [saltA, saltB].sort().join("|") === [a.input, b.input].sort().join("|");
        if (same) {
          declined.push({
            subject,
            reason: `the two salts share an ion, so the swap hands back ${saltA} and ${saltB} — nothing new forms and nothing precipitates`,
          });
        } else {
          declined.push({
            subject,
            reason: `the swap makes ${saltA}(aq) and ${saltB}(aq), which stay dissolved — with no precipitate, nothing drives a reaction`,
          });
        }
      }
    }

    return { proposals, declined: uniqueDeclines(declined) };
  },
};