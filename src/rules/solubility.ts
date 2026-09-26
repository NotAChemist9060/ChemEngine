/**
 * Solubility rules — the ordering that decides whether a double displacement
 * actually happens.
 *
 * The classic table, in the order a textbook states it:
 *
 * 1. Group 1 and ammonium salts are soluble.
 * 2. Nitrates, acetates, chlorates and perchlorates are soluble.
 * 3. Halides are soluble, except the silver and lead(II) ones.
 * 4. Sulfates are soluble, except barium, strontium, lead(II) and calcium.
 * 5. Everything else — carbonate, phosphate, sulfide, hydroxide, oxide — is
 *    insoluble unless rule 1 already said otherwise.
 *
 * **Which side of the rule a salt falls on is read off the graph**, through
 * `splitIons`, so `AgCl` is decided from Ag⁺ + Cl⁻ rather than from pattern
 * matching on a string. "Is it in Group 1" is answered from the elements table
 * rather than a hand-kept list, but the exceptions themselves are written out,
 * because which chlorides precipitate is exactly the measured chemistry the
 * series table is.
 *
 * `undefined` is a real answer here and it is used: a species that does not
 * split (no structure), a salt with two different cations, an anion no rule
 * mentions (chromate, permanganate, silicate), or a genuinely ambiguous case
 * like a mercury halide — HgCl₂ is soluble and Hg₂Cl₂ is not, and the oxidation
 * state is not in the formula. The rule declines and says which of those it was,
 * rather than picking the answer that makes the example work (§3, §7).
 */
import { groupOf } from "../core/elements.ts";
import { splitIons, type Ion } from "./ions.ts";
import type { SpeciesInput } from "./types.ts";

/** What a salt does when it is put in water. */
export type Solubility = "soluble" | "insoluble";

/** A decision plus the sentence that produced it, for the card. */
export interface SolubilityVerdict {
  solubility: Solubility;
  /** The rule that decided it, in the words a textbook uses. */
  reason: string;
}

/** Anions whose salts are all soluble, and the rule that says so. */
const ALWAYS_SOLUBLE: ReadonlyMap<string, string> = new Map([
  ["F", "all fluorides are soluble"],
  ["NO3", "all nitrates are soluble"],
  ["ClO3", "all chlorates are soluble"],
  ["ClO4", "all perchlorates are soluble"],
  ["C2H3O2", "acetates are soluble"],
]);

/** The halide anions, which are soluble but for the cations listed below. */
const HALIDES: ReadonlySet<string> = new Set(["Cl", "Br", "I"]);

/** Cations whose halides precipitate. */
const HALIDE_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["Ag", "silver halides are insoluble — AgCl, AgBr and AgI all precipitate"],
  ["Pb", "lead(II) halides are insoluble — PbCl2, PbBr2 and PbI2 precipitate"],
]);

/** Cations whose sulfates precipitate. */
const SULFATE_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["Ba", "barium sulfate is insoluble"],
  ["Sr", "strontium sulfate is insoluble"],
  ["Pb", "lead(II) sulfate is insoluble"],
  [
    "Ca",
    "calcium sulfate is only sparingly soluble, and is treated here as precipitating",
  ],
]);

/** Anions that precipitate with everything but Group 1 and ammonium. */
const INSOLUBLE_ANIONS: ReadonlyMap<string, string> = new Map([
  ["CO3", "carbonates are insoluble except those of Group 1 and ammonium"],
  ["PO4", "phosphates are insoluble except those of Group 1 and ammonium"],
  ["S", "sulfides are insoluble except those of Group 1 and Group 2"],
  ["OH", "hydroxides are insoluble except those of Group 1 and ammonium"],
  ["O", "oxides are insoluble except those of Group 1 and ammonium"],
]);

/** Ammonium, as the cation formula reads off the graph. */
const AMMONIUM = "NH4";

/** The single cation and anion of a salt, or the reason there is not one. */
type Inspection =
  | { ok: true; cation: Ion; anion: Ion }
  | { ok: false; gap: string };

/**
 * Read a salt's two ions, or say precisely why the rules cannot be applied.
 *
 * The gap text is not decoration: `chem predict` prints it in place of a
 * prediction, so "no solubility rule covers the CrO4 ion" and "more than one
 * kind of cation" are different facts and the card has to be able to tell them
 * apart.
 */
function inspect(species: SpeciesInput): Inspection {
  const split = splitIons(species);
  if (split === undefined) {
    return {
      ok: false,
      gap: `no ion structure for ${species.input}, so the solubility rules do not apply to it`,
    };
  }
  const { cations, anions } = split;
  if (cations.length === 0 || anions.length === 0) {
    return { ok: false, gap: `${species.input} is not a salt — it has no ions of both kinds` };
  }
  // One distinct cation and one distinct anion, however many copies of each:
  // Ca(NO3)2 is one calcium and two nitrates, which is a simple salt. Two
  // different metals in one formula is a double salt, which these rules do not
  // describe — and it is reached by real input, not only by theory: Ag2CrO4
  // comes out of the structure layer as Ag⁺ + Cr²⁺ + 4 O⁻.
  if (!cations.every((ion) => ion.formula === cations[0]!.formula)) {
    const kinds = [...new Set(cations.map((ion) => ion.formula))].join(", ");
    return { ok: false, gap: `${species.input} has more than one kind of cation (${kinds}), which these rules do not cover` };
  }
  if (!anions.every((ion) => ion.formula === anions[0]!.formula)) {
    const kinds = [...new Set(anions.map((ion) => ion.formula))].join(", ");
    return { ok: false, gap: `${species.input} has more than one kind of anion (${kinds}), which these rules do not cover` };
  }
  const cation = cations[0]!;
  const anion = anions[0]!;
  // Mercury before the general rules: the oxidation state is not in the
  // formula, and the two answers are opposites.
  if (cation.formula === "Hg" && HALIDES.has(anion.formula)) {
    return {
      ok: false,
      gap: "mercury makes both a soluble and an insoluble halide (HgCl2 and Hg2Cl2), and the oxidation state is not in the formula",
    };
  }
  return { ok: true, cation, anion };
}

/** Group 1 of the periodic table, asked of the elements table. */
function isGroup1(cation: Ion): boolean {
  if (cation.formula === AMMONIUM) return true;
  if (cation.counts.size !== 1) return false;
  const symbol = [...cation.counts.keys()][0]!;
  // Hydrogen shares group 1 but is not a salt cation; a hydride is not a salt.
  return symbol !== "H" && groupOf(symbol) === 1;
}

/**
 * Does this salt dissolve, and on which rule?
 *
 * `undefined` for anything the rules do not cover — ask `solubilityGap` why.
 */
export function solubilityOf(species: SpeciesInput): SolubilityVerdict | undefined {
  const looked = inspect(species);
  if (!looked.ok) return undefined;
  const { cation, anion } = looked;

  if (isGroup1(cation)) {
    return { solubility: "soluble", reason: "all Group 1 and ammonium salts are soluble" };
  }

  const always = ALWAYS_SOLUBLE.get(anion.formula);
  if (always !== undefined) return { solubility: "soluble", reason: always };

  if (HALIDES.has(anion.formula)) {
    const exception = HALIDE_EXCEPTIONS.get(cation.formula);
    if (exception !== undefined) return { solubility: "insoluble", reason: exception };
    return { solubility: "soluble", reason: "all halides are soluble except those of silver and lead" };
  }

  if (anion.formula === "SO4") {
    const exception = SULFATE_EXCEPTIONS.get(cation.formula);
    if (exception !== undefined) return { solubility: "insoluble", reason: exception };
    return { solubility: "soluble", reason: "all sulfates are soluble except those of barium, strontium, lead and calcium" };
  }

  const insoluble = INSOLUBLE_ANIONS.get(anion.formula);
  if (insoluble !== undefined) return { solubility: "insoluble", reason: insoluble };

  return undefined;
}

/** Why the rules could not decide, in one line. */
export function solubilityGap(species: SpeciesInput): string {
  const looked = inspect(species);
  if (looked.ok) return `no solubility rule covers the ${looked.anion.formula} ion`;
  return looked.gap;
}
