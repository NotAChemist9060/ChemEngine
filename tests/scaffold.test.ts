import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface ElementEntry {
  number: number;
  symbol: string;
  name: string;
  mass: number;
}

function loadElements(): ElementEntry[] {
  const raw = readFileSync(resolve(projectRoot, "data", "elements.json"), "utf8");
  return JSON.parse(raw) as ElementEntry[];
}

describe("scaffold M0", () => {
  it("loads periodic table data with 118 elements", () => {
    const elements = loadElements();
    expect(elements).toHaveLength(118);
  });

  it("starts with hydrogen and ends with oganesson", () => {
    const elements = loadElements();
    const first = elements[0];
    const last = elements[elements.length - 1];
    expect(first).toMatchObject({ number: 1, symbol: "H", name: "Hydrogen" });
    expect(last).toMatchObject({ number: 118, symbol: "Og", name: "Oganesson" });
  });

  it("symbols and numbers are unique", () => {
    const elements = loadElements();
    const symbols = new Set(elements.map((e) => e.symbol));
    const numbers = new Set(elements.map((e) => e.number));
    expect(symbols.size).toBe(118);
    expect(numbers.size).toBe(118);
  });
});