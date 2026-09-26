/**
 * Tier A of the structure builder: exact, curated connectivity for the
 * species the classifier and the M4 reaction rules care about.
 *
 * Hand-writing these is deliberate. A formula does not determine connectivity —
 * C2H6O is ethanol or dimethyl ether, not one or the other — so the species we
 * reason about chemically are pinned here and `fromFormula` constructs only the
 * rest. Where two curated structures genuinely share a formula both are kept
 * and the classifier reports the ambiguity instead of hiding it.
 *
 * Two fields, two jobs: `formula` is the conventional, user-facing text
 * ("CuSO4", "Ca(OH)2"); `key` is the canonical Hill-order lookup key computed
 * from it, so lookups are case- and order-insensitive. The test suite builds
 * every template and asserts it reproduces its own `key`, so a typo in either
 * the DSL or the key fails the build.
 */
import { formatFormula, parseFormula } from "../core/formula.ts";
import { parseIonSet, parseStructure } from "./dsl.ts";
import { cloneMolecule, formulaString } from "./molecule.ts";
import type { Molecule } from "./molecule.ts";

export interface StructureTemplate {
  /** Conventional formula text, as a chemist would write it. */
  formula: string;
  /** Canonical Hill-order key, e.g. "CuO4S". Computed, never hand-written. */
  key: string;
  /** Display name for the classify card. */
  name: string;
  /** Build a fresh graph; callers always get their own copy. */
  build: () => Molecule;
}

function make(formula: string, name: string, build: () => Molecule): StructureTemplate {
  return { formula, key: formatFormula(parseFormula(formula).elements), name, build };
}

function covalent(formula: string, name: string, dsl: string): StructureTemplate {
  return make(formula, name, () => parseStructure(dsl));
}

function salt(formula: string, name: string, ions: readonly string[]): StructureTemplate {
  return make(formula, name, () => parseIonSet(ions));
}

export const TEMPLATES: readonly StructureTemplate[] = [
  // ── water and the oxides ────────────────────────────────────────────────
  covalent("H2O", "water", "O(H)(H)"),
  covalent("CO2", "carbon dioxide", "O(=C=O)"),
  covalent("CO", "carbon monoxide", "C-#O+"), // formal charges: no H is filled in
  covalent("SO2", "sulfur dioxide", "O(=S=O)"),
  covalent("SO3", "sulfur trioxide", "O(=S(=O)=O)"),
  covalent("NO", "nitric oxide", "N+=O-"),
  covalent("NO2", "nitrogen dioxide", "O(=N=O)"),
  salt("Na2O", "sodium oxide", ["Na+", "Na+", "O--"]),
  salt("CaO", "calcium oxide", ["Ca++", "O--"]),
  salt("MgO", "magnesium oxide", ["Mg++", "O--"]),
  salt("Fe2O3", "iron(III) oxide", ["Fe+++", "Fe+++", "O--", "O--", "O--"]),
  salt("Al2O3", "aluminium oxide", ["Al+++", "Al+++", "O--", "O--", "O--"]),
  covalent("SiO2", "silicon dioxide", "O(=Si=O)"),

  // ── acids ───────────────────────────────────────────────────────────────
  covalent("HCl", "hydrogen chloride", "Cl(H)"),
  covalent("HBr", "hydrogen bromide", "Br(H)"),
  covalent("HI", "hydrogen iodide", "I(H)"),
  covalent("HF", "hydrogen fluoride", "F(H)"),
  covalent("H2SO4", "sulfuric acid", "S(=O)(=O)(O(H))(O(H))"),
  covalent("H2SO3", "sulfurous acid", "S(=O)(O(H))(O(H))"),
  covalent("HNO3", "nitric acid", "N(=O)(=O)(O(H))"),
  covalent("H3PO4", "phosphoric acid", "P(=O)(O(H))(O(H))(O(H))"),
  covalent("H2CO3", "carbonic acid", "C(=O)(O(H))(O(H))"),
  covalent("HCN", "hydrocyanic acid", "C(H)#N"),
  covalent("CH3COOH", "acetic acid", "C(H)(H)(C(=O)(O(H)))"),

  // ── bases ───────────────────────────────────────────────────────────────
  covalent("NH3", "ammonia", "N(H)(H)(H)"),
  salt("NaOH", "sodium hydroxide", ["Na+", "O(H)-"]),
  salt("KOH", "potassium hydroxide", ["K+", "O(H)-"]),
  salt("Ca(OH)2", "calcium hydroxide", ["Ca++", "O(H)-", "O(H)-"]),
  salt("Mg(OH)2", "magnesium hydroxide", ["Mg++", "O(H)-", "O(H)-"]),
  salt("Ba(OH)2", "barium hydroxide", ["Ba++", "O(H)-", "O(H)-"]),
  salt("Cu(OH)2", "copper(II) hydroxide", ["Cu++", "O(H)-", "O(H)-"]),
  salt("Al(OH)3", "aluminium hydroxide", ["Al+++", "O(H)-", "O(H)-", "O(H)-"]),

  // ── salts ───────────────────────────────────────────────────────────────
  salt("NaCl", "sodium chloride", ["Na+", "Cl-"]),
  salt("KCl", "potassium chloride", ["K+", "Cl-"]),
  salt("CaCl2", "calcium chloride", ["Ca++", "Cl-", "Cl-"]),
  salt("BaCl2", "barium chloride", ["Ba++", "Cl-", "Cl-"]),
  salt("FeCl3", "iron(III) chloride", ["Fe+++", "Cl-", "Cl-", "Cl-"]),
  salt("CuSO4", "copper(II) sulfate", ["Cu++", "S(=O)(=O)(O-)O-"]),
  salt("FeSO4", "iron(II) sulfate", ["Fe++", "S(=O)(=O)(O-)O-"]),
  salt("ZnSO4", "zinc sulfate", ["Zn++", "S(=O)(=O)(O-)O-"]),
  salt("MgSO4", "magnesium sulfate", ["Mg++", "S(=O)(=O)(O-)O-"]),
  salt("Na2SO4", "sodium sulfate", ["Na+", "Na+", "S(=O)(=O)(O-)O-"]),
  salt("K2SO4", "potassium sulfate", ["K+", "K+", "S(=O)(=O)(O-)O-"]),
  salt("CaSO4", "calcium sulfate", ["Ca++", "S(=O)(=O)(O-)O-"]),
  salt("Na2CO3", "sodium carbonate", ["Na+", "Na+", "C(=O)(O-)O-"]),
  salt("NaNO3", "sodium nitrate", ["Na+", "N(=O)(=O)O-"]),
  salt("KNO3", "potassium nitrate", ["K+", "N(=O)(=O)O-"]),
  salt("CaCO3", "calcium carbonate", ["Ca++", "C(=O)(O-)O-"]),
  salt("Na3PO4", "sodium phosphate", ["Na+", "Na+", "Na+", "P(=O)(O-)(O-)O-"]),
  salt("NH4Cl", "ammonium chloride", ["N(H)(H)(H)(H)+", "Cl-"]),
  salt("NH4NO3", "ammonium nitrate", ["N(H)(H)(H)(H)+", "N(=O)(=O)O-"]),
  salt("(NH4)2SO4", "ammonium sulfate", [
    "N(H)(H)(H)(H)+", "N(H)(H)(H)(H)+", "S(=O)(=O)(O-)O-",
  ]),

  // ── hydrocarbons and common organics ────────────────────────────────────
  covalent("CH4", "methane", "C(H)(H)(H)(H)"),
  covalent("C2H6", "ethane", "C(H)(H)(H)C(H)(H)(H)"),
  covalent("C2H4", "ethene", "C(H)(H)=C(H)(H)"),
  covalent("C2H2", "ethyne", "C(H)#C(H)"),
  covalent("C3H8", "propane", "C(H)(H)(H)C(H)(H)C(H)(H)(H)"),
  covalent("C6H6", "benzene", "C%1=CC=CC=C%1"),
  covalent("C7H8", "toluene", "C%1(C(H)(H)(H))=CC=CC=C%1"),
  covalent("C2H5OH", "ethanol", "C(H)(H)(C(H)(H)(O(H)))"),
  covalent("CH3OH", "methanol", "C(H)(H)(H)O(H)"),
  covalent("C2H6O", "dimethyl ether", "C(H)(H)(H)O(C(H)(H)(H))"),
  covalent("CH3CHO", "acetaldehyde", "C(H)(H)(H)C(=O)H"),
  covalent("CH3COCH3", "acetone", "C(H)(H)(H)C(=O)C(H)(H)(H)"),
  covalent("C6H12O6", "glucose (pyranose form)", "C%1(H)(O(H))C(H)(O(H))C(H)(O(H))C(H)(O(H))C(H)(C(H)(H)O(H))O%1"),
];

const BY_KEY = new Map<string, StructureTemplate[]>();
for (const template of TEMPLATES) {
  const bucket = BY_KEY.get(template.key);
  if (bucket) bucket.push(template);
  else BY_KEY.set(template.key, [template]);
}

/** All curated structures for a canonical key (a formula can be ambiguous). */
export function findTemplates(key: string): StructureTemplate[] {
  return BY_KEY.get(key) ?? [];
}

/** The preferred curated structure for a key, or undefined when not curated. */
export function findTemplate(key: string): StructureTemplate | undefined {
  return BY_KEY.get(key)?.[0];
}

/** Builds a fresh graph for a curated formula, or undefined when unknown. */
export function buildTemplate(key: string): Molecule | undefined {
  const template = findTemplate(key);
  return template ? cloneMolecule(template.build()) : undefined;
}

/** Display names for every curated structure sharing a key. */
export function templateNames(key: string): string[] {
  return findTemplates(key).map((t) => t.name);
}

/** Formula text a template reproduces — the invariant the tests assert. */
export function templateFormula(template: StructureTemplate): string {
  return formulaString(template.build());
}
