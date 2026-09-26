/**
 * The reactivity series, tested as the decision procedure it is: the ordering
 * itself (which is checked against the textbook order, since the table is
 * curated and a transposed pair would silently invert every verdict), and the
 * two cases the single-displacement rule leans on — displacing a metal out of
 * its salt, and displacing hydrogen out of an acid.
 *
 * The negative tests matter as much as the positive ones here. A series that
 * says "yes" to everything would still pass a single metal case, and the whole
 * value of the table is the *no*.
 */
import { describe, expect, it } from "vitest";
import {
  displacesFromSalt,
  displacesHydrogen,
  REACTIVITY_SERIES,
  seriesLine,
  seriesMetal,
  seriesRank,
} from "../src/rules/series.ts";
import { parseSpeciesInput } from "../src/rules/types.ts";

/** The order a textbook prints, to be compared against the table. */
const TEXTBOOK_ORDER = [
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

describe("the series table", () => {
  it("runs in the order the textbook prints", () => {
    expect([...REACTIVITY_SERIES]).toEqual(TEXTBOOK_ORDER);
  });

  it("puts hydrogen between tin and copper, where the acid line falls", () => {
    // The line is the whole point of H being on the list: metals above it lift
    // H2 out of an acid, metals below it do not.
    expect(seriesRank("Pb")!).toBeLessThan(seriesRank("H")!);
    expect(seriesRank("Cu")!).toBeGreaterThan(seriesRank("H")!);
  });

  it("has no duplicates", () => {
    expect(new Set(REACTIVITY_SERIES).size).toBe(REACTIVITY_SERIES.length);
  });

  it("ranks nothing it does not list", () => {
    expect(seriesRank("Zn")).toBe(6);
    expect(seriesRank("Cu")).toBe(11);
    // Not −1, and not 0: an absent element has no position, which is a
    // different answer from "least reactive".
    expect(seriesRank("W")).toBeUndefined();
    expect(seriesRank("")).toBeUndefined();
    expect(seriesRank("zn")).toBeUndefined();
  });

  it("prints as a card line", () => {
    expect(seriesLine()).toBe("K > Na > Li > Ca > Mg > Al > Zn > Fe > Sn > Pb > H > Cu > Hg > Ag > Au");
  });
});

describe("displacing a metal from its salt", () => {
  it("displaces a metal below it", () => {
    const verdict = displacesFromSalt("Zn", "Cu");
    expect(verdict!.displaces).toBe(true);
    expect(verdict!.reason).toBe("Zn is above Cu in the reactivity series, so it displaces it");
  });

  it("does not displace a metal above it, and says so", () => {
    const verdict = displacesFromSalt("Cu", "Zn");
    expect(verdict!.displaces).toBe(false);
    expect(verdict!.reason).toContain("below Zn");
  });

  it("gets every pair in the table the right way round", () => {
    // All 105 ordered pairs, checked against the ordering itself. A transposed
    // entry in the table would show up here rather than in one lucky example.
    for (const above of REACTIVITY_SERIES) {
      for (const below of REACTIVITY_SERIES) {
        if (above === below) continue;
        const expected = seriesRank(above)! < seriesRank(below)!;
        expect(displacesFromSalt(above, below)!.displaces, `${above} vs ${below}`).toBe(expected);
      }
    }
  });

  it("will not displace itself", () => {
    const verdict = displacesFromSalt("Cu", "Cu");
    expect(verdict!.displaces).toBe(false);
    expect(verdict!.reason).toBe("Cu cannot displace itself");
  });

  it("makes no claim about a metal that is not on the series", () => {
    // Not "no" — the engine does not know where tungsten sits, and saying it
    // would not react would be inventing chemistry.
    const unknown = displacesFromSalt("W", "Cu");
    expect(unknown).toBeUndefined();
    const againstUnknown = displacesFromSalt("Zn", "W");
    expect(againstUnknown!.displaces).toBe(false);
    expect(againstUnknown!.reason).toContain("not on the reactivity series");
  });
});

describe("displacing hydrogen from an acid", () => {
  it("reacts above the hydrogen line", () => {
    for (const metal of ["K", "Na", "Ca", "Mg", "Al", "Zn", "Fe", "Sn", "Pb"]) {
      expect(displacesHydrogen(metal)!.displaces, metal).toBe(true);
    }
  });

  it("does not react below it", () => {
    for (const metal of ["Cu", "Hg", "Ag", "Au"]) {
      const verdict = displacesHydrogen(metal);
      expect(verdict!.displaces, metal).toBe(false);
      expect(verdict!.reason, metal).toContain("below hydrogen");
    }
  });

  it("makes no claim about a metal that is not on the series", () => {
    expect(displacesHydrogen("W")).toBeUndefined();
  });

  it("treats hydrogen as a marker rather than a reactant", () => {
    const verdict = displacesHydrogen("H");
    expect(verdict!.displaces).toBe(false);
    expect(verdict!.reason).toBe("hydrogen displaces nothing from an acid");
  });
});

describe("seriesMetal", () => {
  it("recognises a bare metal", () => {
    expect(seriesMetal(parseSpeciesInput("Zn"))).toBe("Zn");
    expect(seriesMetal(parseSpeciesInput("Cu"))).toBe("Cu");
    expect(seriesMetal(parseSpeciesInput("Fe"))).toBe("Fe");
  });

  it("passes on anything that is not one metal", () => {
    for (const formula of ["CH4", "SO4", "Fe2O3", "H2", "O2", "CuSO4", "NaCl"]) {
      expect(seriesMetal(parseSpeciesInput(formula)), formula).toBeUndefined();
    }
  });

  it("passes on a metal the series does not list", () => {
    expect(seriesMetal(parseSpeciesInput("W"))).toBeUndefined();
    expect(seriesMetal(parseSpeciesInput("Pt"))).toBeUndefined();
  });
});
