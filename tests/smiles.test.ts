import { afterEach, describe, expect, it } from "vitest";
import { classify } from "../src/knowledge/classify.ts";
import { parseStructure } from "../src/structure/dsl.ts";
import { neighbors, symbolCounts } from "../src/structure/molecule.ts";
import {
  clearSmilesParser,
  formulaFromSmiles,
  installedSmilesParser,
  readSmiles,
  setSmilesParser,
  type SmilesParser,
} from "../src/structure/smiles.ts";

/** A stand-in parser: the structural DSL, pretending to be a real one. */
const fake: SmilesParser = {
  name: "fake",
  parse: (input) => parseStructure(input),
};

afterEach(() => {
  clearSmilesParser();
});

describe("the not-installed path", () => {
  it("says a parser is missing instead of guessing", () => {
    const result = readSmiles("CCO");
    expect(result.ok).toBe(false);
    expect(result.parser).toBeNull();
    expect(result.ok === false && result.reason).toContain("no SMILES parser is installed");
  });

  it("has no parser installed to begin with", () => {
    expect(installedSmilesParser()).toBeUndefined();
    expect(formulaFromSmiles("CCO")).toBeUndefined();
  });

  it("names the parser when one is installed but declines", () => {
    setSmilesParser({ name: "picky", parse: () => undefined });
    const result = readSmiles("CCO");
    expect(result.ok).toBe(false);
    expect(result.parser).toBe("picky");
    expect(result.ok === false && result.reason).toContain("did not recognise");
  });
});

describe("the registry", () => {
  it("installs, hands back, and clears a parser", () => {
    setSmilesParser(fake);
    expect(installedSmilesParser()?.name).toBe("fake");
    clearSmilesParser();
    expect(installedSmilesParser()).toBeUndefined();
  });

  it("replaces an earlier parser rather than stacking them", () => {
    const other: SmilesParser = { name: "other", parse: () => undefined };
    setSmilesParser(fake);
    setSmilesParser(other);
    const result = readSmiles("CCO");
    expect(result.ok === false && result.parser).toBe("other");
  });

  it("takes a parser directly, without touching the registry", () => {
    const result = readSmiles("CCO", fake);
    expect(result.ok).toBe(true);
    expect(installedSmilesParser()).toBeUndefined();
  });
});

describe("reading a molecule", () => {
  it("returns the same graph model the formula path builds", () => {
    const result = readSmiles("C(H)(H)(H)C(H)(H)(O(H))", fake);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parser).toBe("fake");
    expect(result.formula).toBe("C2H6O");
    expect(result.molecule.atoms).toHaveLength(3);
    expect(result.molecule.atoms[0]!.hydrogens).toBe(3);
    expect(neighbors(result.molecule, 2)).toHaveLength(1);
  });

  it("counts the element totals of the graph", () => {
    const result = readSmiles("C(H)(H)(H)C(H)(H)(O(H))", fake);
    if (!result.ok) throw new Error("expected a molecule");
    const counts = symbolCounts(result.molecule);
    expect(counts.get("C")).toBe(2);
    expect(counts.get("O")).toBe(1);
  });

  it("hands the formula on to the classifier", () => {
    const formula = formulaFromSmiles("C(H)(H)(H)C(H)(H)(O(H))", fake);
    expect(formula).toBe("C2H6O");
    expect(classify(formula!).primary).toBe("alcohol");
  });

  it("turns a parser that throws into a reason, not a crash", () => {
    const broken: SmilesParser = {
      name: "broken",
      parse: () => {
        throw new Error("unexpected end of input");
      },
    };
    const result = readSmiles("CCO", broken);
    expect(result.ok).toBe(false);
    expect(result.parser).toBe("broken");
    expect(result.ok === false && result.reason).toBe("broken could not read it: unexpected end of input");
  });
});
