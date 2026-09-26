import { describe, expect, it } from "vitest";
import {
  allElements,
  getElement,
  getElementByNumber,
  groupOf,
  loadElements,
  periodOf,
  shellsOf,
  tryGetElement,
} from "../src/core/elements.ts";

describe("periodic table data", () => {
  it("loads 118 elements with masses, groups and periods", () => {
    const els = allElements();
    expect(els).toHaveLength(118);
    for (const el of els) {
      expect(el.number).toBeGreaterThan(0);
      expect(el.symbol).toMatch(/^[A-Z][a-z]?$/);
      expect(el.mass).toBeGreaterThan(0);
      expect(el.period, `${el.symbol} period`).toBeGreaterThanOrEqual(1);
      expect(el.period, `${el.symbol} period`).toBeLessThanOrEqual(7);
    }
  });

  it("numbers elements 1..118 in order", () => {
    allElements().forEach((el, i) => expect(el.number).toBe(i + 1));
  });

  it("has a group for every element except the 28 f-block ones", () => {
    const missing = allElements().filter((e) => e.group === undefined).map((e) => e.symbol);
    // La, Ce..Yb and Ac, Th..No: no group in IUPAC long form without a block column.
    expect(missing).toEqual([
      "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
      "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No",
    ]);
  });

  it("puts every element in the period its atomic number implies", () => {
    const edges: Array<[number, number]> = [
      [1, 2], [3, 10], [11, 18], [19, 36], [37, 54], [55, 86], [87, 118],
    ];
    for (const [first, last] of edges) {
      const period = periodOf(getElementByNumber(first).symbol);
      for (let z = first; z <= last; z++) {
        expect(periodOf(getElementByNumber(z).symbol), `Z=${z}`).toBe(period);
      }
    }
  });

  it("places the classic main-group markers", () => {
    expect(groupOf("H")).toBe(1);
    expect(groupOf("He")).toBe(18);
    expect(groupOf("Li")).toBe(1);
    expect(groupOf("Ne")).toBe(18);
    expect(groupOf("C")).toBe(14);
    expect(groupOf("N")).toBe(15);
    expect(groupOf("O")).toBe(16);
    expect(groupOf("F")).toBe(17);
    expect(groupOf("Na")).toBe(1);
    expect(groupOf("Cl")).toBe(17);
    expect(groupOf("K")).toBe(1);
    expect(groupOf("Br")).toBe(17);
    expect(groupOf("Fe")).toBe(8);
    expect(groupOf("Cu")).toBe(11);
    expect(groupOf("Ag")).toBe(11);
    expect(groupOf("Au")).toBe(11);
    expect(groupOf("Hg")).toBe(12);
    expect(groupOf("Pb")).toBe(14);
  });

  it("places f-block boundaries in group 3", () => {
    expect(groupOf("La")).toBe(3);
    expect(groupOf("Lu")).toBe(3);
    expect(groupOf("Ac")).toBe(3);
    expect(groupOf("Lr")).toBe(3);
    expect(groupOf("Ce")).toBeUndefined();
    expect(groupOf("U")).toBeUndefined();
  });
});

describe("lookups", () => {
  it("is case-insensitive and trims", () => {
    expect(getElement("fe").symbol).toBe("Fe");
    expect(getElement(" O ").symbol).toBe("O");
  });

  it("throws a descriptive error for an unknown symbol", () => {
    expect(() => getElement("Zz")).toThrow(/unknown element symbol 'Zz'/);
    expect(() => getElementByNumber(119)).toThrow(/no element with atomic number 119/);
  });

  it("tryGetElement returns undefined instead of throwing", () => {
    expect(tryGetElement("nope")).toBeUndefined();
    expect(tryGetElement("na")?.number).toBe(11);
    expect(groupOf("nope")).toBeUndefined();
    expect(periodOf("nope")).toBeUndefined();
  });

  it("period doubles as the shell count", () => {
    for (const [sym, shells] of [["H", 1], ["C", 2], ["Fe", 4], ["Au", 6], ["Og", 7]] as const) {
      expect(shellsOf(sym)).toBe(shells);
    }
  });

  it("caches the table between calls", () => {
    expect(loadElements()).toBe(loadElements());
  });
});
