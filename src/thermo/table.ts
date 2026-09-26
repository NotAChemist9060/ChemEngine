/**
 * The thermochemistry table: standard Gibbs energies of formation, indexed
 * for lookup.
 *
 * `data/thermo.json` is keyed on the formula the way a chemist writes it
 * ("NaOH", "Ca(OH)2"), because that is how a person maintaining the file reads
 * it. Lookups, though, have to be order- and case-insensitive, so the loader
 * computes a canonical Hill-order `key` from every formula and indexes on that
 * — the same two-field split `structure/templates.ts` uses.
 *
 * **Phases are part of the key, not a detail.** `H2O(l)` is −237.13 and
 * `H2O(g)` is −228.57 kJ/mol, an 8.6 kJ/mol swing that decides whether
 * methane combustion reads as −818 or −801 kJ/mol. So an entry carries one
 * value per phase, a lookup that names a phase the entry lacks is an explicit
 * `unknown`, and a lookup that names *no* phase is only answered when the
 * species has a single phase or declares a `defaultState`. Guessing which
 * phase a person meant would be exactly the confident wrong answer the plan
 * forbids (§3, §7), and the two are both reported instead.
 *
 * `parseThermoTable` is pure and validating, so a malformed data file is
 * caught in the test suite rather than at the user's terminal; `loadThermoTable`
 * is the thin cached file read around it, mirroring `core/elements.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PhysicalState } from "../core/equation.ts";
import { formatFormula, parseFormula } from "../core/formula.ts";

/** The only temperature this table is valid at (§7: no temperature dependence yet). */
export const THERMO_TEMPERATURE = 298.15;

const PHASES: readonly PhysicalState[] = ["s", "l", "g", "aq"];

export interface ThermoEntry {
  /** Formula as written in the data file, e.g. "Ca(OH)2". */
  formula: string;
  /** Canonical Hill-order lookup key, computed on load: "CaH2O2". */
  key: string;
  /** Display name, e.g. "calcium hydroxide". */
  name: string;
  /** Where the number came from, so a value can be audited or re-derived. */
  source: string;
  /** ΔGf° in kJ/mol per phase. Absent phases are unknown, never zero. */
  dGf: Readonly<Partial<Record<PhysicalState, number>>>;
  /** Phase to assume when a caller names none; absent means "ask". */
  defaultState?: PhysicalState;
}

export interface ThermoTable {
  temperature: number;
  unit: string;
  species: readonly ThermoEntry[];
  byKey: ReadonlyMap<string, ThermoEntry>;
}

/** A resolved ΔGf°, or a stated reason why there isn't one. */
export type ThermoLookup =
  | {
      known: true;
      /** kJ/mol at `THERMO_TEMPERATURE`. */
      kj: number;
      state: PhysicalState;
      entry: ThermoEntry;
    }
  | {
      known: false;
      /** The formula as the caller wrote it. */
      formula: string;
      /** Why no value: no entry, wrong phase, or phase unspecified. */
      reason: string;
    };

interface RawSpecies {
  formula?: unknown;
  name?: unknown;
  source?: unknown;
  dGf?: unknown;
  defaultState?: unknown;
}

/**
 * Validate raw parsed JSON into a table, computing the lookup keys.
 *
 * Throws on anything a chemist would call a data bug: a formula that does not
 * parse, a phase that is not a physical state, a value that is not a finite
 * number, an entry with no values at all, or two entries for the same species.
 */
export function parseThermoTable(raw: unknown): ThermoTable {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("thermo table: expected an object at the top level");
  }
  const doc = raw as { temperature?: unknown; unit?: unknown; species?: unknown };
  if (typeof doc.temperature !== "number" || !Number.isFinite(doc.temperature)) {
    throw new Error("thermo table: 'temperature' must be a number (298.15)");
  }
  if (typeof doc.unit !== "string" || doc.unit.length === 0) {
    throw new Error("thermo table: 'unit' must be a non-empty string ('kJ/mol')");
  }
  if (!Array.isArray(doc.species)) {
    throw new Error("thermo table: 'species' must be an array");
  }

  const species: ThermoEntry[] = [];
  const byKey = new Map<string, ThermoEntry>();
  doc.species.forEach((rawSpecies, i) => {
    const entry = parseSpecies(rawSpecies, i);
    const clash = byKey.get(entry.key);
    if (clash !== undefined) {
      throw new Error(
        `thermo table: '${entry.formula}' and '${clash.formula}' are the same species ` +
          `(key ${entry.key}); keep one entry with one value per phase`,
      );
    }
    byKey.set(entry.key, entry);
    species.push(entry);
  });

  return { temperature: doc.temperature, unit: doc.unit, species, byKey };
}

function parseSpecies(raw: unknown, i: number): ThermoEntry {
  const where = `thermo species #${i + 1}`;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${where}: expected an object`);
  }
  const entry = raw as RawSpecies;
  if (typeof entry.formula !== "string" || entry.formula.trim().length === 0) {
    throw new Error(`${where}: 'formula' must be a non-empty string`);
  }
  const formula = entry.formula.trim();
  if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
    throw new Error(`${where} (${formula}): 'name' must be a non-empty string`);
  }
  if (typeof entry.source !== "string" || entry.source.trim().length === 0) {
    throw new Error(`${where} (${formula}): 'source' must be a non-empty string`);
  }

  let key: string;
  try {
    key = formatFormula(parseFormula(formula).elements);
  } catch (err) {
    throw new Error(`${where} (${formula}): ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof entry.dGf !== "object" || entry.dGf === null || Array.isArray(entry.dGf)) {
    throw new Error(`${where} (${formula}): 'dGf' must be an object keyed by phase, e.g. { "l": -237.13 }`);
  }
  const rawPhases = entry.dGf as Record<string, unknown>;
  const phaseNames = Object.keys(rawPhases);
  if (phaseNames.length === 0) {
    throw new Error(`${where} (${formula}): 'dGf' has no phase values — an unknown species is left out, not written as 0`);
  }
  const dGf: Partial<Record<PhysicalState, number>> = {};
  for (const phase of phaseNames) {
    if (!isPhase(phase)) {
      throw new Error(`${where} (${formula}): '${phase}' is not a physical state (use ${PHASES.join(", ")})`);
    }
    const value = rawPhases[phase];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${where} (${formula}): ΔGf° for ${formula}(${phase}) is not a finite number`);
    }
    dGf[phase] = value;
  }

  let defaultState: PhysicalState | undefined;
  if (entry.defaultState !== undefined) {
    if (typeof entry.defaultState !== "string" || !isPhase(entry.defaultState)) {
      throw new Error(`${where} (${formula}): 'defaultState' must be one of ${PHASES.join(", ")}`);
    }
    if (dGf[entry.defaultState] === undefined) {
      throw new Error(
        `${where} (${formula}): 'defaultState' is '${entry.defaultState}', which has no value`,
      );
    }
    defaultState = entry.defaultState;
  }

  const out: ThermoEntry = { formula, key, name: entry.name.trim(), source: entry.source.trim(), dGf };
  if (defaultState !== undefined) out.defaultState = defaultState;
  return out;
}

function isPhase(value: string): value is PhysicalState {
  return (PHASES as readonly string[]).includes(value);
}

let cache: ThermoTable | null = null;

/** The embedded table, read once per process. */
export function loadThermoTable(): ThermoTable {
  if (cache) return cache;
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "thermo.json");
  cache = parseThermoTable(JSON.parse(readFileSync(file, "utf8")) as unknown);
  return cache;
}

/**
 * The entry for a formula, whatever order it is written in: "HCl", "ClH" and
 * "Hcl"-style variants all resolve, because the key is canonical. Returns
 * `undefined` for an unknown or unreadable formula — a formula is user input,
 * so this never throws.
 */
export function thermoEntry(formula: string): ThermoEntry | undefined {
  const key = tryThermoKey(formula);
  return key === undefined ? undefined : loadThermoTable().byKey.get(key);
}

/** Canonical Hill-order key for a formula, or `undefined` if it cannot be read. */
export function tryThermoKey(formula: string): string | undefined {
  try {
    return formatFormula(parseFormula(formula).elements);
  } catch {
    return undefined;
  }
}

/**
 * ΔGf° in kJ/mol for a species in a phase.
 *
 * Without a phase the answer comes back `unknown` unless the species has one
 * phase or declares a `defaultState`; a named phase the entry lacks is
 * `unknown` too. Either way the reason names what would have been needed, so
 * the caller can print something better than "no data".
 */
export function dGfOf(formula: string, state?: PhysicalState): ThermoLookup {
  const entry = thermoEntry(formula);
  if (entry === undefined) {
    return { known: false, formula, reason: `no ΔGf° entry for '${formula}'` };
  }
  const phases = Object.keys(entry.dGf) as PhysicalState[];
  if (state !== undefined) {
    const kj = entry.dGf[state];
    if (kj === undefined) {
      return {
        known: false,
        formula,
        reason: `no ΔGf° for ${entry.formula}(${state}) — the table has ${listPhases(phases)}`,
      };
    }
    return { known: true, kj, state, entry };
  }
  const fallback = entry.defaultState ?? (phases.length === 1 ? phases[0] : undefined);
  if (fallback === undefined) {
    return {
      known: false,
      formula,
      reason: `${entry.formula} has more than one phase (${listPhases(phases)}) — say which one`,
    };
  }
  return { known: true, kj: entry.dGf[fallback]!, state: fallback, entry };
}

/** "l, g, aq" — the phases an entry does have, for a "say which one" reason. */
function listPhases(phases: readonly PhysicalState[]): string {
  return phases.join(", ");
}
