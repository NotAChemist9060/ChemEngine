import { describe, expect, it } from "vitest";
import { classify, tryClassify, type Classification } from "../src/knowledge/classify.ts";

/** "primary | rest" for a compact, readable assertion. */
function classes(result: Classification): string {
  return result.classes.join("|");
}

describe("classification reads the structure, not the string", () => {
  it("reports the species class, its evidence, and the build it read off", () => {
    const result = classify("C2H5OH");
    expect(result.primary).toBe("alcohol");
    expect(classes(result)).toBe("alcohol");
    expect(result.reasoning).toHaveLength(result.classes.length);
    expect(result.reasoning[0]).toContain("O–H");
    expect(result.formula).toBe("C2H6O");
    expect(result.molarMass).toBeCloseTo(46.07, 1);
    expect(result.fromStructure).toBe(true);
    expect(result.structure.source).toBe("template");
  });

  it("keeps reasoning in step with classes", () => {
    const result = classify("C6H5COOH");
    expect(result.classes).toHaveLength(result.reasoning.length);
    result.classes.forEach((_, index) => expect(result.reasoning[index]).not.toBe(""));
  });

  it("reports the honest answer for something no class covers", () => {
    const result = classify("XeF2");
    expect(result.primary).toBe("unknown");
    expect(result.classes).toEqual([]);
    expect(result.reasoning).toEqual([]);
    expect(result.fromStructure).toBe(false);
    expect(result.caveats.join(" ")).toContain("no connectivity");
  });

  it("returns undefined for input that is not a formula", () => {
    expect(tryClassify("not a formula")).toBeUndefined();
    expect(tryClassify("C2H5OH")?.primary).toBe("alcohol");
  });
});

describe("inorganic classes", () => {
  it("calls H2O water and nothing else", () => {
    const result = classify("H2O");
    expect(result.classes).toEqual(["water"]);
    expect(result.reasoning[0]).toContain("H2O");
  });

  it("calls an oxoacid an acid, citing the hydroxyls", () => {
    const result = classify("H2SO4");
    expect(result.primary).toBe("acid");
    expect(result.reasoning[0]).toContain("2 hydroxyls");
    expect(result.reasoning[0]).toContain("S");
  });

  it("calls a binary hydride of a halogen an acid", () => {
    expect(classify("HCl").primary).toBe("acid");
    expect(classify("HCl").reasoning[0]).toContain("H⁺");
  });

  it("does not call ammonia's own hydrogens an acid", () => {
    const result = classify("NH3");
    expect(result.classes).toEqual(["base"]);
    expect(result.classes).not.toContain("acid");
  });

  it("calls a hydroxide a base and a hydroxide, but not a salt", () => {
    const result = classify("NaOH");
    expect(result.classes).toEqual(["base", "hydroxide"]);
    expect(result.classes).not.toContain("salt");
  });

  it("calls a metal hydroxide a base too", () => {
    expect(classify("Ca(OH)2").primary).toBe("base");
    expect(classify("Fe(OH)3").primary).toBe("base");
  });

  it("calls a salt a salt, naming the ions", () => {
    const result = classify("NaCl");
    expect(result.classes).toEqual(["salt"]);
    expect(result.reasoning[0]).toContain("Na+");
    expect(result.reasoning[0]).toContain("Cl-");
  });

  it("counts repeated ions", () => {
    expect(classify("BaCl2").reasoning[0]).toContain("Cl-1 ×2");
  });

  it("calls a salt of an oxyanion a salt, not an oxide", () => {
    const result = classify("KMnO4");
    expect(result.primary).toBe("salt");
    expect(result.classes).not.toContain("oxide");
  });

  it("calls a metal oxide an oxide, not a salt", () => {
    const result = classify("Fe2O3");
    expect(result.classes).toEqual(["oxide"]);
  });

  it("does not call oxygen gas an oxide of itself", () => {
    expect(classify("O2").classes).toEqual(["element"]);
  });

  it("calls a bare metal a metal and an element", () => {
    const result = classify("Fe");
    expect(result.classes).toEqual(["metal", "element"]);
  });

  it("calls H2O2 a peroxide, not an acid", () => {
    const result = classify("H2O2");
    expect(result.classes).toEqual(["peroxide"]);
    expect(result.reasoning[0]).toContain("O–O");
  });

  it("calls a salt a salt even when it also holds a peroxide", () => {
    const result = classify("Na2O2");
    expect(result.primary).toBe("salt");
    expect(result.classes).toContain("peroxide");
  });

  it("calls simple substances of non-metals elements", () => {
    expect(classify("N2").classes).toEqual(["element"]);
    expect(classify("S8").classes).toEqual(["element"]);
  });

  it("still names H2 an element from the formula alone", () => {
    const result = classify("H2");
    expect(result.classes).toEqual(["element"]);
    expect(result.fromStructure).toBe(false);
  });

  it("calls a hydrate a hydrate and the salt inside it a salt", () => {
    const result = classify("CuSO4·5H2O");
    expect(result.primary).toBe("hydrate");
    expect(result.classes).toContain("salt");
    expect(result.reasoning[0]).toContain("5 water molecules");
  });
});

describe("organic classes", () => {
  it("calls a carboxylic acid a carboxylic acid first, and an acid too", () => {
    const result = classify("CH3COOH");
    expect(result.classes).toEqual(["carboxylic-acid", "acid"]);
  });

  it("calls formic acid a carboxylic acid", () => {
    expect(classify("HCOOH").primary).toBe("carboxylic-acid");
  });

  it("calls carbonic acid an oxoacid, not a carboxylic acid", () => {
    const result = classify("H2CO3");
    expect(result.classes).toEqual(["acid"]);
    expect(result.reasoning[0]).toContain("oxoacid");
  });

  it("calls an aldehyde an aldehyde", () => {
    expect(classify("CH3CHO").classes).toEqual(["aldehyde"]);
  });

  it("calls a ketone a ketone", () => {
    expect(classify("CH3COCH3").classes).toEqual(["ketone"]);
  });

  it("calls a C=O with an –O–C an ester", () => {
    const result = classify("CH3COOCH3");
    expect(result.primary).toBe("ester");
    expect(result.classes).not.toContain("ether");
    expect(classify("CH3COOC2H5").classes).toEqual(["ester"]);
  });

  it("does not call CO2 an ester or an acid", () => {
    expect(classify("CO2").classes).toEqual(["oxide"]);
  });

  it("calls an alcohol an alcohol", () => {
    expect(classify("CH3OH").classes).toEqual(["alcohol"]);
  });

  it("calls a ring oxygen between two carbons an ether", () => {
    const result = classify("C6H5OCH3");
    expect(result.primary).toBe("ether");
    expect(result.classes).not.toContain("alcohol");
  });

  it("builds C3H8O as a propanol, and says so by class", () => {
    const result = classify("C3H8O");
    expect(result.structure.source).toBe("constructed");
    expect(result.primary).toBe("alcohol");
  });

  it("calls a ring with a hydroxyl a phenol rather than an alcohol", () => {
    const result = classify("C6H5OH");
    expect(result.classes).toContain("alcohol");
    expect(result.classes).toContain("aromatic");
    expect(result.reasoning[0]).toContain("phenol");
  });

  it("calls an amine an amine, and does not call it an acid", () => {
    const result = classify("CH3NH2");
    expect(result.classes).toEqual(["amine"]);
  });

  it("does not call a nitrile an amine", () => {
    const result = classify("HCN");
    expect(result.classes).toEqual(["acid"]);
    expect(result.reasoning[0]).toContain("triple-bonded");
  });

  it("calls a benzene ring aromatic, and a chain hydrocarbon not", () => {
    expect(classify("C6H6").primary).toBe("aromatic");
    expect(classify("C6H6").classes).toContain("hydrocarbon");
    expect(classify("C7H16").classes).toEqual(["hydrocarbon"]);
  });
});

describe("specificity ordering and ambiguity", () => {
  it("puts the most telling class first", () => {
    expect(classify("C6H5COOH").primary).toBe("carboxylic-acid");
    expect(classify("NaOH").primary).toBe("base");
    expect(classify("CuSO4·5H2O").primary).toBe("hydrate");
    expect(classify("C6H5CHO").primary).toBe("aldehyde");
  });

  it("says a formula that fits two curated structures cannot choose", () => {
    const result = classify("C2H6O");
    expect(result.caveats.join(" ")).toContain("ethanol");
    expect(result.caveats.join(" ")).toContain("dimethyl ether");
  });

  it("has no caveat when the formula is unambiguous", () => {
    expect(classify("CH3COOH").caveats).toEqual([]);
  });

  it("reports a lower-confidence build without changing what it can see", () => {
    const result = classify("C7H16");
    expect(result.structure.source).toBe("constructed");
    expect(result.structure.confidence).not.toBe("high");
    expect(result.primary).toBe("hydrocarbon");
  });
});
