import { describe, expect, it } from "vitest";
import {
  dGfOf,
  loadThermoTable,
  parseThermoTable,
  THERMO_TEMPERATURE,
  thermoEntry,
  tryThermoKey,
} from "../src/thermo/table.ts";

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
        // A ΔGf° outside this band is a units slip (J vs kJ), not chemistry.
        expect(Math.abs(kj), `${entry.formula}(${phase})`).toBeLessThan(3000);
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
