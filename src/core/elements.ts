import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ElementData {
  number: number;
  symbol: string;
  name: string;
  /** Atomic mass in g/mol (standard atomic weight). */
  mass: number;
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