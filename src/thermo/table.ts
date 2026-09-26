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
 * **Single ions are first-class entries**, which is what makes the aqueous
 * half of the table checkable: an aqueous salt is the sum of its ionic values
 * (H+(aq) = 0 by definition), and `tests/thermo-table.test.ts` re-derives every
 * such entry from the ions the structure layer finds in it. A transcription
 * slip in a salt cannot survive that check.
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
  /** Formula as written in the data file, e.g. "Ca(OH)2", "SO4^2-". */
  formula: string;
  /** Canonical Hill-order lookup key, computed on load: "CaH2O2", "O4S-2". */
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
  const split = splitCharge(formula);
  try {
    key = canonicalKey(split.atoms, split.charge);
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
 * "H2O" all resolve, because the key is canonical. Returns `undefined` for an
 * unknown or unreadable formula — a formula is user input, so this never
 * throws.
 *
 * A digit run right before the sign gets one second reading, because the plain
 * one cannot serve both `Ca^2+` and `NO3-`: the first wants its "2" read as the
 * charge, the second keeps it as a subscript. The table decides, in that order
 * — plain reading first, then the charge reading — and a formula that matches
 * neither is `undefined` rather than a guess.
 */
export function thermoEntry(formula: string): ThermoEntry | undefined {
  const table = loadThermoTable();
  for (const key of candidateKeys(formula)) {
    const entry = table.byKey.get(key);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

/** The keys a formula could mean, most literal reading first. */
function candidateKeys(formula: string): string[] {
  const primary = tryThermoKey(formula);
  if (primary === undefined) return [];
  const alt = tryTrailingDigitsAsCharge(formula);
  return alt === undefined || alt === primary ? [primary] : [primary, alt];
}

/**
 * The second reading of a charge: the digit immediately before the sign is the
 * magnitude, so "Ca2+" is calcium with a 2+ charge and "SO42-" is sulfate.
 *
 * Only the last digit moves, never the whole run: for "SO42-" the "4" belongs to
 * the atom formula and the "2" to the charge, and the alternative reading that
 * swallows both would invent sulfur oxide. `undefined` when there is no such
 * digit.
 */
function tryTrailingDigitsAsCharge(formula: string): string | undefined {
  const text = formula.trim();
  const match = /(\d)([+-])$/.exec(text);
  if (match === null || match.index === 0) return undefined;
  const magnitude = Number(match[1]);
  try {
    return canonicalKey(text.slice(0, match.index), match[2] === "+" ? magnitude : -magnitude);
  } catch {
    return undefined;
  }
}

/** Canonical Hill-order key for a formula, or `undefined` if it cannot be read. */
export function tryThermoKey(formula: string): string | undefined {
  try {
    const split = splitCharge(formula);
    return canonicalKey(split.atoms, split.charge);
  } catch {
    return undefined;
  }
}

/**
 * Canonical key for an atom formula and a charge: Hill order for the atoms,
 * then the charge as a signed integer ("Cl-1", "SO4" → "O4S-2", "Ca" → "Ca+2").
 *
 * One normal form matters because the same ion reaches the table written three
 * ways — "SO4^2-" in the data file, "O4S-2" from the structure layer, "SO42-"
 * from a person at the terminal — and they have to land on one entry.
 */
function canonicalKey(atoms: string, charge: number): string {
  const base = formatFormula(parseFormula(atoms).elements);
  if (charge === 0) return base;
  return `${base}${charge > 0 ? `+${charge}` : `-${-charge}`}`;
}

interface ChargedFormula {
  /** The part a formula parser can read, e.g. "SO4" for "SO4^2-". */
  atoms: string;
  /** Signed; 0 for a neutral formula. */
  charge: number;
}

/**
 * Read a written formula's charge suffix, e.g. `SO4^2-` → `SO4` and −2.
 *
 * Exported because there is exactly one charge reader in the engine: the rules
 * layer builds salts and conjugate bases from ion formulas, and it reuses this
 * rather than growing a second parser that would disagree about `SO42-`.
 * `undefined` when the formula cannot be read at all.
 */
export function splitChargedFormula(formula: string): ChargedFormula | undefined {
  try {
    const split = splitCharge(formula);
    parseFormula(split.atoms);
    return split;
  } catch {
    return undefined;
  }
}

/**
 * Split a written formula into atoms and charge.
 *
 * Three unambiguous spellings are accepted, and they are the three this
 * codebase produces between it:
 *
 * - `SO4^2-`, `Fe3+` — a caret, then the magnitude, then the sign
 * - `SO4-2`, `Na+1` — the sign, then the magnitude (what the structure layer
 *   emits, and what a person types who thinks of the sign as unary)
 * - `Na+`, `Ca++` — a bare sign, where the magnitude is one
 *
 * A digit run *directly* before a sign is not read as a magnitude here, because
 * `SO4^2-` and `NO3-` cannot both be spelled that way: for the first the "4" is
 * a subscript and the "2" a charge, for the second the "3" is a subscript and
 * the charge is one. The plain reading wins, and `thermoEntry` retries the other
 * reading only if the plain one is not in the table — so `NO3-` resolves to
 * nitrate and `Ca2+` to calcium, and a formula that is in neither reading is
 * reported as an unknown rather than guessed at.
 */
function splitCharge(formula: string): ChargedFormula {
  const text = formula.trim();
  const end = text.length - 1;
  if (end < 1) return { atoms: text, charge: 0 };
  const isDigit = (i: number): boolean => i >= 0 && /\d/.test(text[i]!);

  let sign: "+" | "-" | undefined;
  /** Digits after the sign, as in `SO4-2`. */
  let trailing = "";
  /** Repeated signs, as in the older `Ca++`. */
  let extra = 0;
  let cursor = end;

  if (text[end] === "+" || text[end] === "-") {
    sign = text[end] as "+" | "-";
    while (extra < end && text[end - extra - 1] === sign) extra++;
    cursor = end - extra;
  } else if (isDigit(end)) {
    while (isDigit(cursor - 1)) cursor--;
    const before = text[cursor - 1];
    if (before === "+" || before === "-") {
      sign = before;
      trailing = text.slice(cursor, end + 1);
      cursor -= 1;
    }
  }
  if (sign === undefined) return { atoms: text, charge: 0 };

  // Digits between the sign and a caret are the magnitude: `SO4^2-`, `Fe^3+`.
  // Without the caret they belong to the atom formula — that is the whole
  // reason `SO42-` and `H2O2-` cannot both be read as the reader expects.
  let leading = "";
  let digitsBeforeSign = 0;
  while (isDigit(cursor - 1 - digitsBeforeSign)) digitsBeforeSign++;
  const caret = cursor - 1 - digitsBeforeSign;
  if (text[caret] === "^") {
    leading = text.slice(caret + 1, cursor);
    cursor = caret;
  }

  const atoms = text.slice(0, cursor);
  if (atoms.length === 0) return { atoms: text, charge: 0 };
  const written = Number(leading || trailing || "0");
  const magnitude = extra > 0 ? extra + 1 : written > 0 ? written : 1;
  return { atoms, charge: sign === "+" ? magnitude : -magnitude };
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
