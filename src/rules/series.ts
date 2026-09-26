/**
 * The reactivity series — the ordering that decides single displacement.
 *
 * This is a **curated table**, not a computed one. Nothing in a formula says
 * whether zinc will pull copper out of copper sulfate; that is measured
 * chemistry, and the only honest way to carry it is to write it down. The same
 * stance `structure/templates.ts` took, and the reason §7 can promise that
 * prediction covers encoded classes and says so outside them.
 *
 * The order runs most reactive first, which is why the index is the ranking:
 * a smaller index displaces a larger one. Hydrogen sits in the list because it
 * is the dividing line for the acid case — a metal above it lifts hydrogen out
 * of an acid, a metal below it does not.
 *
 * Every verdict comes back with the sentence that justifies it, because
 * "nothing happens" without "Cu is below Zn in the series" is the confident
 * wrong answer the plan refuses (§3, §7).
 */
import { parseFormula } from "../core/formula.ts";

/** The series, most reactive first. Hydrogen is the marker, not a metal. */
export const REACTIVITY_SERIES: readonly string[] = [
  "K",
  "Na",
  "Li",
  "Ca",
  "Mg",
  "Al",
  "Zn",
  "Fe",
  "Sn",
  "Pb",
  "H",
  "Cu",
  "Hg",
  "Ag",
  "Au",
];

/** A yes or no, with the sentence behind it. */
export interface SeriesVerdict {
  displaces: boolean;
  /** One line for the card, naming the two positions on the series. */
  reason: string;
}

/**
 * Where hydrogen sits. Taken straight off the table rather than through
 * `seriesRank`, because hydrogen is a fact about this file's own list — the test
 * pins the order, so a missing H would be a failed test rather than a runtime
 * surprise.
 */
const HYDROGEN_RANK = REACTIVITY_SERIES.indexOf("H");

/**
 * Where an element sits, counting from the most reactive.
 *
 * `undefined` when the element is not on the series. That distinction matters:
 * `indexOf` answers −1, and a rank of −1 would compare as "more reactive than
 * everything", which is how tungsten ends up looking displaceable.
 */
export function seriesRank(element: string): number | undefined {
  const index = REACTIVITY_SERIES.indexOf(element);
  return index === -1 ? undefined : index;
}

/** The series as a card line, e.g. `K > Na > Ca > Mg > Al > Zn > Fe > Sn > Pb > H > Cu > Ag`. */
export function seriesLine(): string {
  return REACTIVITY_SERIES.join(" > ");
}

/**
 * Will `metal` displace `otherMetal` out of one of its compounds?
 *
 * `undefined` when either element is off the series, which is a different
 * answer from "no": the engine does not know where tungsten sits, and saying it
 * will not react would be inventing chemistry.
 */
export function displacesFromSalt(metal: string, otherMetal: string): SeriesVerdict | undefined {
  const mine = seriesRank(metal);
  const theirs = seriesRank(otherMetal);
  if (mine === undefined) return undefined;
  if (theirs === undefined) {
    // A compound of something not on the series: no claim either way.
    return { displaces: false, reason: `${otherMetal} is not on the reactivity series, so the order against it is unknown` };
  }
  if (metal === otherMetal) {
    return { displaces: false, reason: `${metal} cannot displace itself` };
  }
  if (mine < theirs) {
    return {
      displaces: true,
      reason: `${metal} is above ${otherMetal} in the reactivity series, so it displaces it`,
    };
  }
  return {
    displaces: false,
    reason: `${metal} sits below ${otherMetal} in the reactivity series, so it cannot displace it`,
  };
}

/**
 * Will `metal` lift hydrogen out of an acid, as a metal + acid → salt + H2?
 *
 * `undefined` when the metal is off the series.
 */
export function displacesHydrogen(metal: string): SeriesVerdict | undefined {
  const mine = seriesRank(metal);
  if (mine === undefined) return undefined;
  if (mine < HYDROGEN_RANK) {
    return { displaces: true, reason: `${metal} is above hydrogen, so it displaces H2 from an acid` };
  }
  if (mine === HYDROGEN_RANK) {
    return { displaces: false, reason: "hydrogen displaces nothing from an acid" };
  }
  return {
    displaces: false,
    reason: `${metal} sits below hydrogen in the reactivity series, so it does not displace H2 from an acid`,
  };
}

/**
 * The metal a species is, if it is one metal on the series.
 *
 * `undefined` for anything that is not a bare element, so a caller cannot
 * accidentally look up `SO4` and get a confident answer about sulfate — and
 * `undefined` for hydrogen too, since its place on the series marks the line
 * the acid case is read against rather than making it something that displaces.
 */
export function seriesMetal(species: { formula: string }): string | undefined {
  const { elements } = parseFormula(species.formula);
  if (elements.size !== 1) return undefined;
  const symbol = [...elements.keys()][0]!;
  if (symbol === "H") return undefined;
  return seriesRank(symbol) !== undefined ? symbol : undefined;
}
