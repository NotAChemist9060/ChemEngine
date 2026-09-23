import { describe, expect, it } from "vitest";
import {
  rat, ratAdd, ratDiv, ratEq, ratFromDecimal, ratMul, ratScaleToInts,
  ratSub, ratToString,
} from "../src/util/rational.ts";

describe("rational arithmetic", () => {
  it("reduces fractions to lowest terms", () => {
    expect(ratToString(rat(4n, 6n))).toBe("2/3");
    expect(ratToString(rat(5n, 1n))).toBe("5");
  });

  it("normalizes negative denominators", () => {
    expect(ratToString(rat(1n, -2n))).toBe("-1/2");
  });

  it("adds, subtracts, multiplies, divides", () => {
    expect(ratToString(ratAdd(rat(1n, 2n), rat(1n, 3n)))).toBe("5/6");
    expect(ratToString(ratSub(rat(2n, 3n), rat(1n, 6n)))).toBe("1/2");
    expect(ratToString(ratMul(rat(2n, 3n), rat(3n, 4n)))).toBe("1/2");
    expect(ratToString(ratDiv(rat(1n, 2n), rat(3n, 4n)))).toBe("2/3");
  });

  it("parses decimals exactly", () => {
    expect(ratToString(ratFromDecimal("0.5"))).toBe("1/2");
    expect(ratToString(ratFromDecimal("-1.25"))).toBe("-5/4");
    expect(ratToString(ratFromDecimal("3"))).toBe("3");
  });

  it("rejects zero denominators", () => {
    expect(() => rat(1n, 0n)).toThrow(/division by zero/);
    expect(() => ratDiv(rat(1n), rat(0n))).toThrow(/division by zero/);
  });

  it("scales to smallest integers", () => {
    const scaled = ratScaleToInts([
      rat(1n, 2n), rat(2n, 3n), rat(1n, 4n), rat(1n),
    ]);
    expect(scaled.map(String)).toEqual(["6", "8", "3", "12"]);
  });

  it("compares and tests equality", () => {
    expect(ratEq(rat(2n, 4n), rat(1n, 2n))).toBe(true);
  });
});