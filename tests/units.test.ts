import { describe, expect, it } from "vitest";
import {
  formatDim, formatQuantity, parseDim, parseQuantity, sameDim, unitForOrder,
} from "../src/util/units.ts";

describe("units", () => {
  it("parses L·mol⁻¹·s⁻¹", () => {
    const d = parseDim("L·mol⁻¹·s⁻¹");
    expect(d).toEqual({ mol: -1, L: 1, s: -1 });
  });

  it("parses M as mol/L", () => {
    expect(parseDim("M")).toEqual({ mol: 1, L: -1, s: 0 });
  });

  it("parses s⁻¹ and 1/s equivalently", () => {
    expect(sameDim(parseDim("s⁻¹"), parseDim("1/s"))).toBe(true);
    expect(sameDim(parseDim("1/s"), parseDim("s^-1"))).toBe(true);
  });

  it("parses slash-chains and caret notation", () => {
    expect(parseDim("L/mol/s")).toEqual({ mol: -1, L: 1, s: -1 });
    expect(parseDim("L mol^-1 s^-1")).toEqual({ mol: -1, L: 1, s: -1 });
    expect(parseDim("1/(M·s)")).toEqual({ mol: -1, L: 1, s: -1 });
  });

  it("formats dimensions canonically and round-trips", () => {
    expect(formatDim({ mol: -1, L: 1, s: -1 })).toBe("L·mol⁻¹·s⁻¹");
    expect(formatDim({ mol: -2, L: 2, s: -1 })).toBe("L²·mol⁻²·s⁻¹");
    expect(sameDim(parseDim(formatDim({ mol: 2, L: -2, s: -1 })), { mol: 2, L: -2, s: -1 })).toBe(true);
  });

  it("computes the required rate-constant unit for a reaction order", () => {
    expect(sameDim(unitForOrder(1), parseDim("s⁻¹"))).toBe(true);
    expect(sameDim(unitForOrder(2), parseDim("L·mol⁻¹·s⁻¹"))).toBe(true);
    expect(sameDim(unitForOrder(3), parseDim("L²·mol⁻²·s⁻¹"))).toBe(true);
  });

  it("parses quantities with values", () => {
    expect(parseQuantity("10 M")).toEqual({ value: 10, dim: { mol: 1, L: -1, s: 0 } });
    expect(parseQuantity("0.1 L·mol⁻¹·s⁻¹").value).toBeCloseTo(0.1);
    expect(formatQuantity(parseQuantity("5 s⁻¹"))).toBe("5 s⁻¹");
    expect(parseQuantity("5")).toEqual({ value: 5, dim: { mol: 0, L: 0, s: 0 } });
  });

  it("rejects garbage units", () => {
    expect(() => parseDim("banana")).toThrow(/unrecognized unit token/);
    expect(() => parseQuantity("abc M")).toThrow(/invalid quantity/);
  });
});