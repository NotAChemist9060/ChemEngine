import { getElement } from "./elements.ts";

export interface FormulaResult {
  /** Original input, whitespace stripped. */
  formula: string;
  /** Element symbol → atom count (integers). */
  elements: Map<string, number>;
  /** Molar mass in g/mol. */
  molarMass: number;
}

/**
 * Parse a chemical formula into element counts and molar mass.
 * Supports "H2O", "C6H12O6", "(NH4)2SO4", nested groups, and hydrates
 * "CuSO4·5H2O". Throws descriptive errors on unknown elements or bad syntax.
 */
export function parseFormula(input: string): FormulaResult {
  const clean = input.replace(/\s+/g, "");
  if (!clean) throw new Error("empty formula");
  const groups = clean.split("·");
  const elements = new Map<string, number>();
  let mass = 0;
  for (let i = 0; i < groups.length; i++) {
    const el = parseUnitGroup(groups[i]!, i > 0);
    mergeInto(elements, el.elements);
    mass += el.molarMass;
  }
  return { formula: input.trim(), elements, molarMass: mass };
}

/** Molar mass from a pre-computed element-count map. */
export function molarMassFromCounts(counts: Map<string, number>): number {
  let mass = 0;
  for (const [sym, n] of counts) mass += getElement(sym).mass * n;
  return mass;
}

/**
 * Canonical formula text in Hill order: carbon first, then hydrogen, then
 * every other element alphabetically. Elements with count 0 are dropped and
 * count 1 omits the "1". With no carbon the order is purely alphabetical.
 *
 * The structure layer uses this as the round-trip target for graphs it builds
 * (`formulaOf(mol)` → parse → same counts), which is why it never emits
 * parentheses, hydrates or charges.
 */
export function formatFormula(counts: ReadonlyMap<string, number>): string {
  const present = [...counts].filter(([, n]) => n > 0).map(([sym]) => sym);
  const ordered = present.includes("C")
    ? ["C", "H", ...present.filter((s) => s !== "C" && s !== "H").sort()]
    : [...present].sort();
  let out = "";
  for (const sym of ordered) {
    const n = counts.get(sym) ?? 0;
    if (n <= 0) continue;
    out += n === 1 ? sym : `${sym}${n}`;
  }
  return out;
}

/** Formula text of an element-count map, with `·`-separated hydrates. */
export function formatFormulaParts(parts: ReadonlyArray<ReadonlyMap<string, number>>): string {
  return parts.map((p) => formatFormula(p)).join("·");
}

function parseUnitGroup(group: string, allowLeadingCoefficient: boolean): FormulaResult {
  if (!group) throw new Error("empty formula unit");
  if (!allowLeadingCoefficient && /^[0-9]/.test(group)) {
    throw new Error(`formula '${group}': unexpected leading coefficient (only allowed after '·' in hydrates)`);
  }
  const m = /^(\d+)(.*)$/.exec(group);
  if (m && m[2] !== undefined && m[2].length > 0) {
    const scale = parseInt(m[1]!, 10);
    const elements = parseSequence(m[2]);
    for (const [k, v] of elements) elements.set(k, v * scale);
    return { formula: group, elements, molarMass: molarMassFromCounts(elements) };
  }
  const elements = parseSequence(group);
  return { formula: group, elements, molarMass: molarMassFromCounts(elements) };
}

function parseSequence(s: string): Map<string, number> {
  const out = new Map<string, number>();
  let i = 0;
  const readNumber = (): number => {
    let n = 0;
    let started = false;
    while (i < s.length && s[i]! >= "0" && s[i]! <= "9") {
      n = n * 10 + (s.charCodeAt(i) - 48);
      i++;
      started = true;
    }
    return started ? n : 1;
  };

  while (i < s.length) {
    const c = s[i]!;
    if (c === "(") {
      i++;
      const innerStart = i;
      let depth = 1;
      while (i < s.length && depth > 0) {
        const ch = s[i]!;
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth > 0) i++;
      }
      if (depth !== 0) throw new Error(`formula '${s}': unbalanced parentheses`);
      const inner = parseSequence(s.slice(innerStart, i));
      i++;
      const mult = readNumber();
      scaleBy(inner, mult);
      mergeInto(out, inner);
    } else if (c === ")") {
      throw new Error(`formula '${s}': unbalanced parentheses`);
    } else if (c >= "A" && c <= "Z") {
      let j = i + 1;
      while (j < s.length && s[j]! >= "a" && s[j]! <= "z") j++;
      const sym = s.slice(i, j);
      i = j;
      const count = readNumber();
      addTo(out, sym, count);
    } else {
      throw new Error(`formula '${s}': unexpected character '${c}' at position ${i}`);
    }
  }
  return out;
}

function addTo(map: Map<string, number>, sym: string, n: number): void {
  map.set(sym, (map.get(sym) ?? 0) + n);
}

function scaleBy(map: Map<string, number>, factor: number): void {
  for (const [k, v] of map) map.set(k, v * factor);
}

function mergeInto(target: Map<string, number>, src: Map<string, number>): void {
  for (const [k, v] of src) addTo(target, k, v);
}