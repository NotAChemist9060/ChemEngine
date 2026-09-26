import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ElementData {
  number: number;
  symbol: string;
  name: string;
  /** Atomic mass in g/mol (standard atomic weight). */
  mass: number;
  /** IUPAC group 1–18. Absent for f-block elements (La–Lu, Ac–Lr), which
   *  have no group without a block column — use `groupOf` and handle undefined. */
  group?: number;
  /** Period 1–7. Present for all 118 elements. */
  period?: number;
}

let cache: ElementData[] | null = null;

export function loadElements(): ElementData[] {
  if (cache) return cache;
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "elements.json");
  cache = JSON.parse(readFileSync(file, "utf8")) as ElementData[];
  return cache;
}

export function allElements(): ElementData[] {
  return loadElements();
}

/** Case-insensitive symbol lookup, e.g. "o" → Oxygen, "Fe" → Iron. */
export function getElement(symbol: string): ElementData {
  const s = symbol.trim();
  const el = loadElements().find((e) => e.symbol.toLowerCase() === s.toLowerCase());
  if (!el) throw new Error(`unknown element symbol '${symbol.trim()}'`);
  return el;
}

export function getElementByNumber(number: number): ElementData {
  const el = loadElements().find((e) => e.number === number);
  if (!el) throw new Error(`no element with atomic number ${number}`);
  return el;
}

/**
 * IUPAC group 1–18, or undefined for f-block elements (La–Lu, Ac–Lr) and
 * unknown symbols. Use `tryGetGroup` when a lookup failure is not an error.
 */
export function groupOf(symbol: string): number | undefined {
  return tryGetElement(symbol)?.group;
}

/** Period 1–7. Undefined only for an unknown symbol. */
export function periodOf(symbol: string): number | undefined {
  return tryGetElement(symbol)?.period;
}

/** Number of occupied electron shells, or undefined for an unknown symbol. */
export function shellsOf(symbol: string): number | undefined {
  return periodOf(symbol);
}

/** Case-insensitive lookup that returns undefined instead of throwing. */
export function tryGetElement(symbol: string): ElementData | undefined {
  const s = symbol.trim();
  return loadElements().find((e) => e.symbol.toLowerCase() === s.toLowerCase());
}