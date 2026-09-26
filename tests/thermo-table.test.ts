import { describe, expect, it } from "vitest";
import {
  dGfOf,
  loadThermoTable,
  parseThermoTable,
  THERMO_TEMPERATURE,
  thermoEntry,
  tryThermoKey,
} from "../src/thermo/table.ts";
import { buildStructure } from "../src/structure/fromFormula.ts";
import { components, type Molecule } from "../src/structure/molecule.ts";
import { formatFormula } from "../src/core/formula.ts";

const table = loadThermoTable();

/** A minimal well-formed table, for the rejection cases. */
function raw(overrides: Record<string, unknown> = {}): unknown {
  return {
    temperature: 298.15,
    unit: "kJ/mol",
    species: [{ formula: "H2O", name: "water", source: "test", dGf: { l: -237.13 } }],
    ...overrides,
  };
}

describe("thermo table data", () => {
  it("loads at 298.15 K in kJ/mol", () => {
    expect(table.temperature).toBe(THERMO_TEMPERATURE);
    expect(table.unit).toBe("kJ/mol");
    expect(table.species.length).toBeGreaterThan(0);
  });

  it("gives every species a formula, a name and a source", () => {
    for (const entry of table.species) {
      expect(entry.formula, entry.key).toMatch(/\S/);
      expect(entry.name.length, entry.formula).toBeGreaterThan(0);
      expect(entry.source.length, entry.formula).toBeGreaterThan(0);
    }
  });

  it("computes a Hill-order key that matches the written formula", () => {
    for (const entry of table.species) {
      // parseFormula -> formatFormula is the round trip templates.ts relies on.
      expect(entry.key, entry.formula).toBe(tryThermoKey(entry.formula));
    }
    // The keys are not the written text — that is the point of having both.
    expect(table.byKey.get("CaH2O2")?.formula).toBe("Ca(OH)2");
    expect(table.byKey.get("ClH")?.formula).toBe("HCl");
  });

  it("only uses physical states and finite values", () => {
    for (const entry of table.species) {
      const phases = Object.keys(entry.dGf);
      expect(phases.length, entry.formula).toBeGreaterThan(0);
      for (const phase of phases) {
        expect(["s", "l", "g", "aq"], `${entry.formula}(${phase})`).toContain(phase);
        const kj = entry.dGf[phase as keyof typeof entry.dGf]!;
        expect(Number.isFinite(kj), entry.formula).toBe(true);
        // A ΔGf° outside this band is a units slip (J written as kJ), not chemistry.
        expect(Math.abs(kj), `${entry.formula}(${phase})`).toBeLessThan(5000);
      }
    }
  });

  it("has no two entries for the same species", () => {
    expect(table.byKey.size).toBe(table.species.length);
  });

  it("puts every element in its standard reference state at 0", () => {
    // 0 for a simple substance is a definition, so these entries are pinned:
    // a transcription slip here would silently shift any reaction it takes part in.
    const referenceStates: ReadonlyArray<[string, string]> = [
      ["H2", "g"],
      ["O2", "g"],
      ["N2", "g"],
      ["Cl2", "g"],
      ["C", "s"],
      ["S", "s"],
      ["Na", "s"],
      ["Fe", "s"],
      ["Zn", "s"],
      ["Cu", "s"],
    ];
    for (const [formula, state] of referenceStates) {
      const found = dGfOf(formula, state as "s" | "l" | "g" | "aq");
      expect(found.known, `${formula}(${state})`).toBe(true);
      if (found.known) expect(found.kj, `${formula}(${state})`).toBe(0);
    }
  });

  it("carries both phases of water, and they differ", () => {
    const liquid = dGfOf("H2O", "l");
    const gas = dGfOf("H2O", "g");
    expect(liquid.known && liquid.kj).toBe(-237.13);
    expect(gas.known && gas.kj).toBe(-228.57);
  });
});

describe("thermo lookup", () => {
  it("finds an entry however the formula is written", () => {
    expect(thermoEntry("NaOH")?.name).toBe("sodium hydroxide");
    expect(thermoEntry("H2O")?.name).toBe("water");
    // Hill order without carbon is alphabetical, so HNaO and CaH2O2 are keys.
    expect(thermoEntry("Ca(OH)2")?.key).toBe("CaH2O2");
  });

  it("returns undefined instead of throwing on unreadable formulas", () => {
    expect(thermoEntry("XyZ")).toBeUndefined();
    expect(thermoEntry("H2O(")).toBeUndefined();
    expect(thermoEntry("")).toBeUndefined();
    expect(tryThermoKey("2H2O")).toBeUndefined();
  });

  it("resolves a phase the species has", () => {
    const found = dGfOf("H2O", "l");
    expect(found.known).toBe(true);
    if (found.known) {
      expect(found.kj).toBe(-237.13);
      expect(found.state).toBe("l");
      expect(found.entry.source.length).toBeGreaterThan(0);
    }
  });

  it("answers a single-phase species when no phase is named", () => {
    const found = dGfOf("CO2");
    expect(found.known).toBe(true);
    if (found.known) {
      expect(found.state).toBe("g");
      expect(found.kj).toBe(-394.36);
    }
  });

  it("asks which phase when the species has several and none is named", () => {
    const found = dGfOf("H2O");
    expect(found.known).toBe(false);
    if (!found.known) expect(found.reason).toMatch(/more than one phase.*l, g, aq/);
  });

  it("names the phases it does have when the requested one is missing", () => {
    const found = dGfOf("H2O", "s");
    expect(found.known).toBe(false);
    if (!found.known) expect(found.reason).toMatch(/no ΔGf° for H2O\(s\).*l, g, aq/);
  });

  it("reports an absent species as unknown rather than zero", () => {
    const found = dGfOf("XeF2", "s");
    expect(found.known).toBe(false);
    if (!found.known) expect(found.reason).toBe("no ΔGf° entry for 'XeF2'");
  });
});

describe("ion keys", () => {
  it("canonicalises every unambiguous way of writing a charge", () => {
    // The data file writes "SO4^2-", the structure layer emits "O4S-2", and
    // either can be typed with the magnitude after the sign.
    expect(tryThermoKey("SO4^2-")).toBe("O4S-2");
    expect(tryThermoKey("O4S-2")).toBe("O4S-2");
    expect(tryThermoKey("SO4-2")).toBe("O4S-2");
    expect(tryThermoKey("Ca^2+")).toBe("Ca+2");
    expect(tryThermoKey("Ca+2")).toBe("Ca+2");
    expect(tryThermoKey("Na+")).toBe("Na+1");
    expect(tryThermoKey("Al^3+")).toBe("Al+3");
    expect(tryThermoKey("Ca++")).toBe("Ca+2");
    expect(tryThermoKey("NH4+")).toBe("H4N+1");
    expect(tryThermoKey("OH-")).toBe("HO-1");
  });

  it("lets the table settle the ambiguous charge spelling", () => {
    // "NO3-" keeps its 3 as a subscript; "Ca2+" and "SO42-" need their trailing
    // digit read as the charge. The plain reading is tried first, so nitrate
    // cannot be mistaken for a triply charged nitrogen oxide.
    expect(thermoEntry("NO3-")?.name).toBe("nitrate ion");
    expect(thermoEntry("Ca2+")?.name).toBe("calcium ion");
    expect(thermoEntry("SO42-")?.name).toBe("sulfate ion");
    expect(thermoEntry("Fe3+")?.name).toBe("iron(III) ion");
    // A charged formula that is in neither reading is a miss, not a guess.
    expect(thermoEntry("H2O2-")).toBeUndefined();
    expect(dGfOf("H2O2-", "aq").known).toBe(false);
  });

  it("leaves a neutral formula's key charge-free", () => {
    expect(tryThermoKey("H2O")).toBe("H2O");
    expect(tryThermoKey("CH3COOH")).toBe("C2H4O2");
    expect(tryThermoKey("C6H6")).toBe("C6H6");
    expect(tryThermoKey("H2O2")).toBe("H2O2");
  });

  it("keeps an ion and the element it is made of apart", () => {
    // Na(s) and Na+(aq) are different species with different keys; a table that
    // conflated them would silently apply the element's 0 to the ion.
    expect(tryThermoKey("Na")).toBe("Na");
    expect(tryThermoKey("Na+")).toBe("Na+1");
    expect(thermoEntry("Na")?.name).toBe("sodium");
    expect(thermoEntry("Na+")?.name).toBe("sodium ion");
  });

  it("finds ions by any spelling", () => {
    expect(dGfOf("SO4^2-", "aq")).toMatchObject({ known: true, kj: -744.63 });
    expect(dGfOf("O4S-2", "aq")).toMatchObject({ known: true, kj: -744.63 });
    expect(dGfOf("OH-", "aq")).toMatchObject({ known: true, kj: -157.24 });
    expect(dGfOf("H+", "aq")).toMatchObject({ known: true, kj: 0 });
  });
});

/**
 * The ions a species is made of, in the spelling the structure layer produces
 * (Hill-ordered atoms, charge as a signed integer) so a `dGfOf` lookup reaches
 * the ion entries in the table.
 */
function ionFormulas(formula: string): string[] | null {
  const built = buildStructure(formula);
  if (built.molecule === null) return null;
  return components(built.molecule).map((indices) => partFormula(built.molecule as Molecule, indices));
}

function partFormula(mol: Molecule, indices: number[]): string {
  const counts = new Map<string, number>();
  let charge = 0;
  for (const index of indices) {
    const atom = mol.atoms[index]!;
    counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1);
    if (atom.hydrogens > 0) counts.set("H", (counts.get("H") ?? 0) + atom.hydrogens);
    charge += atom.charge;
  }
  const base = formatFormula(counts);
  return charge === 0 ? base : `${base}${charge > 0 ? `+${charge}` : `-${-charge}`}`;
}

describe("aqueous values against the ion-sum convention", () => {
  /** An aqueous entry is only checkable if every ion in it has a value. */
  function ionSum(formula: string): number | null {
    const ions = ionFormulas(formula);
    if (ions === null) return null;
    const positive = ions.filter((ion) => dGfOf(ion, "aq").known && ionCharge(ion) > 0);
    const negative = ions.filter((ion) => ionCharge(ion) < 0);
    if (positive.length === 0 || negative.length === 0) return null;
    let total = 0;
    for (const ion of [...positive, ...negative]) {
      const value = dGfOf(ion, "aq");
      if (!value.known) return null;
      total += value.kj;
    }
    return total;
  }

  function ionCharge(ion: string): number {
    const sign = /[+-]/.exec(ion);
    if (sign === null) return 0;
    const magnitude = Number(/(\d+)$/.exec(ion)?.[1] ?? "1");
    return ion[sign.index] === "+" ? magnitude : -magnitude;
  }

  const aqueous = table.species.filter(
    (entry) => entry.dGf.aq !== undefined && !/[+-]\d*$/.test(entry.formula),
  );

  it("has enough aqueous entries to be worth checking", () => {
    expect(aqueous.length).toBeGreaterThan(25);
  });

  it("re-derives every aqueous salt from the ionic values", () => {
    const checked: string[] = [];
    const skipped: string[] = [];
    for (const entry of aqueous) {
      const sum = ionSum(entry.formula);
      if (sum === null) {
        skipped.push(entry.formula);
        continue;
      }
      checked.push(entry.formula);
      expect(entry.dGf.aq, `${entry.formula}(aq)`).toBeCloseTo(sum, 1);
    }
    // A salt the structure layer cannot split yet (CH3COONa is empirical) is
    // skipped rather than silently counted as verified.
    expect(checked.length, `skipped: ${skipped.join(", ")}`).toBeGreaterThan(25);
  });

  it("reproduces the acid dissociation constant it implies", () => {
    // Ka is not in the table, but the acid/base pairs we do have have to agree
    // with the constant they represent: ΔG° = RT·ln(1/Ka).
    const acid = dGfOf("CH3COOH", "aq");
    const acetate = dGfOf("CH3COO-", "aq");
    const hydrogen = dGfOf("H+", "aq");
    expect(acid.known && acetate.known && hydrogen.known).toBe(true);
    if (!acid.known || !acetate.known || !hydrogen.known) return;
    const rt = 0.008314 * 298.15;
    // CH3COOH(aq) -> H+(aq) + CH3COO-(aq); Ka = 1.8e-5
    const dg = acetate.kj + hydrogen.kj - acid.kj;
    expect(Math.exp(-dg / rt)).toBeCloseTo(1.8e-5, 6);
  });
});

describe("parseThermoTable validation", () => {
  it("accepts a well-formed table and indexes it by key", () => {
    const parsed = parseThermoTable(raw());
    expect(parsed.species).toHaveLength(1);
    expect(parsed.byKey.get("H2O")?.name).toBe("water");
  });

  it("rejects two entries for the same species", () => {
    const duplicate = raw({
      species: [
        { formula: "H2O", name: "water", source: "test", dGf: { l: -237.13 } },
        { formula: "H2O", name: "water again", source: "test", dGf: { g: -228.57 } },
      ],
    });
    expect(() => parseThermoTable(duplicate)).toThrow(/same species/);
  });

  it("rejects a formula it cannot parse", () => {
    expect(() => parseThermoTable(raw({ species: [{ formula: "H2O(", name: "x", source: "t", dGf: { l: 1 } }] }))).toThrow(
      /H2O\(/,
    );
  });

  it("rejects a phase that is not a physical state", () => {
    expect(() => parseThermoTable(raw({ species: [{ formula: "H2O", name: "x", source: "t", dGf: { x: -1 } }] }))).toThrow(
      /'x' is not a physical state/,
    );
  });

  it("rejects a value that is not a finite number", () => {
    expect(() => parseThermoTable(raw({ species: [{ formula: "H2O", name: "x", source: "t", dGf: { l: "-237" } }] }))).toThrow(
      /not a finite number/,
    );
  });

  it("rejects an entry with no values, so 'unknown' is never written as 0", () => {
    expect(() => parseThermoTable(raw({ species: [{ formula: "XeF2", name: "x", source: "t", dGf: {} }] }))).toThrow(
      /no phase values/,
    );
  });

  it("rejects an entry with no name or no source", () => {
    expect(() => parseThermoTable(raw({ species: [{ formula: "H2O", source: "t", dGf: { l: -1 } }] }))).toThrow(/'name'/);
    expect(() => parseThermoTable(raw({ species: [{ formula: "H2O", name: "x", dGf: { l: -1 } }] }))).toThrow(/'source'/);
  });

  it("rejects a defaultState with no value behind it", () => {
    const bad = raw({
      species: [{ formula: "H2O", name: "x", source: "t", dGf: { l: -1 }, defaultState: "g" }],
    });
    expect(() => parseThermoTable(bad)).toThrow(/'defaultState' is 'g', which has no value/);
  });

  it("rejects a table that is missing its header or species list", () => {
    expect(() => parseThermoTable(null)).toThrow(/object at the top level/);
    expect(() => parseThermoTable(raw({ temperature: "298.15" }))).toThrow(/'temperature' must be a number/);
    expect(() => parseThermoTable(raw({ unit: "" }))).toThrow(/'unit'/);
    expect(() => parseThermoTable(raw({ species: {} }))).toThrow(/'species' must be an array/);
  });

  it("uses a defaultState when the species declares one", () => {
    const parsed = parseThermoTable(
      raw({ species: [{ formula: "NH3", name: "ammonia", source: "t", dGf: { g: -16.45, aq: -26.5 }, defaultState: "aq" }] }),
    );
    const entry = parsed.byKey.get("H3N")!;
    expect(entry.defaultState).toBe("aq");
  });
});
