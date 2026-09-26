/**
 * Species classification, with the evidence that decided it.
 *
 * Classification runs on the *structure* from `structure/fromFormula.ts`, not on
 * the formula string, because the groups that matter are groups of atoms: an
 * alcohol is an O–H on a saturated carbon, a carboxylic acid is a carbon that
 * wears both a double-bonded oxygen and an –OH. A formula alone cannot see any
 * of that, and guessing from the string is exactly the kind of confident wrong
 * answer the plan forbids (plan §3).
 *
 * When no connectivity could be built (Tier C, `molecule: null`) the classifier
 * says so — `fromStructure: false` — and reports only the classes a formula can
 * honestly support on its own: water, hydrate, element, peroxide.
 *
 * Classes come out in specificity order, so `classes[0]`, the `primary`, is the
 * most telling label: a carboxylic acid is an acid, but it is reported as a
 * carboxylic acid. `reasoning[i]` is the evidence for `classes[i]`.
 */
import { molarMassFromCounts, parseFormula } from "../core/formula.ts";
import { buildStructure, tryBuildStructure, type StructureBuild } from "../structure/fromFormula.ts";
import {
  bondedOrder,
  components,
  neighbors,
  ringCount,
  symbolCounts,
  type Molecule,
} from "../structure/molecule.ts";
import { findTemplates } from "../structure/templates.ts";
import { isChalcogen, isHalogen, isMetal } from "../structure/valence.ts";

/** Species classes the classifier reports. */
export type SpeciesClass =
  // inorganic
  | "acid"
  | "base"
  | "salt"
  | "metal"
  | "oxide"
  | "hydroxide"
  | "water"
  | "peroxide"
  | "element"
  // organic
  | "hydrocarbon"
  | "alcohol"
  | "aldehyde"
  | "ketone"
  | "carboxylic-acid"
  | "ester"
  | "ether"
  | "amine"
  | "aromatic"
  // crystal
  | "hydrate";

export interface Classification {
  /** What the user typed, unchanged. */
  input: string;
  /** Canonical Hill-order formula. */
  formula: string;
  /** Most telling class, or "unknown" when nothing applies. */
  primary: SpeciesClass | "unknown";
  /** Every class that applies, most telling first. */
  classes: SpeciesClass[];
  /** Evidence for `classes[i]`, in step with it. */
  reasoning: string[];
  /** Honest limits: ambiguous formulas, or a missing structure. */
  caveats: string[];
  /** False when only the empirical formula was available to classify. */
  fromStructure: boolean;
  /** The structure the classes were read off, notes included. */
  structure: StructureBuild;
  /** g/mol. */
  molarMass: number;
}

/** Accumulates classes in specificity order, with one line of evidence each. */
class Findings {
  readonly classes: SpeciesClass[] = [];
  readonly reasoning: string[] = [];

  add(cls: SpeciesClass, why: string): void {
    if (this.classes.includes(cls)) return;
    this.classes.push(cls);
    this.reasoning.push(why);
  }
}

/** Every ring of exactly `size` atoms, deduplicated by membership. */
function ringsOfSize(mol: Molecule, size: number): number[][] {
  const found = new Map<string, number[]>();
  const walk = (path: number[], seen: Set<number>): void => {
    const last = path[path.length - 1]!;
    for (const next of neighbors(mol, last)) {
      if (next === path[0] && path.length === size) {
        const ring = [...path].sort((a, b) => a - b);
        found.set(ring.join(","), ring);
        continue;
      }
      if (path.length < size && !seen.has(next)) {
        seen.add(next);
        path.push(next);
        walk(path, seen);
        path.pop();
        seen.delete(next);
      }
    }
  };
  for (const atom of mol.atoms) walk([atom.index], new Set([atom.index]));
  return [...found.values()];
}

/** The order of the bond between two bonded atoms, or 0 when there is none. */
function bondedOrderBetween(mol: Molecule, a: number, b: number): number {
  return (
    mol.bonds.find((bond) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a))?.order ?? 0
  );
}

/** The atom `index` is bonded to, or undefined when it is bonded to none or many. */
function onlyNeighbour(mol: Molecule, index: number): number | undefined {
  const around = neighbors(mol, index);
  return around.length === 1 ? around[0] : undefined;
}

/** The atom `index` shares a double bond with, when it is of `symbol`. */
function doubleBondPartner(mol: Molecule, index: number, symbol: string): number | undefined {
  for (const bond of mol.bonds) {
    if (bond.order !== 2) continue;
    const other = bond.a === index ? bond.b : bond.b === index ? bond.a : -1;
    if (other >= 0 && mol.atoms[other]!.symbol === symbol) return other;
  }
  return undefined;
}

interface Evidence {
  /** O–H on a saturated carbon that is not in a ring. */
  alcoholO: number[];
  /** O–H on a ring carbon: a phenol, which is not an alcohol. */
  phenolO: number[];
  /** O–H on an atom that is neither carbon nor oxygen: an oxoacid's hydroxyls. */
  oxoacidOH: number[];
  carboxylC: number[];
  aldehydeC: number[];
  ketoneC: number[];
  esterC: number[];
  /** H on a triple-bonded carbon: the nitrile acids, HCN being the one that matters. */
  nitrileAcid: number[];
  etherO: number[];
  amineN: number[];
  /** Six-membered rings with three double bonds inside: benzene, pyridine. */
  aromatic: number;
  /** Atoms that sit in one of those rings — a ring alone is not aromatic. */
  aromaticAtoms: Set<number>;
  rings: number;
  /** An O–O single bond, i.e. a peroxide link. */
  peroxide: boolean;
  cations: number;
  anions: number;
  /** Free OH⁻ anions. */
  hydroxideAnions: number;
  /** Free O²⁻ anions, the kind Fe2O3 is made of. */
  oxideAnions: number;
  /** Free anions of some other element: Cl⁻, S²⁻, the salt-making kind. */
  simpleAnions: number;
  /** Anions that belong to a polyatomic ion, e.g. the O⁻ of a phosphate. */
  polyatomicAnions: number;
  /** Neutral ammonia: a nitrogen carrying hydrogens and nothing else. */
  ammonia: boolean;
  /** Ions as readable labels, e.g. "Na+ ×2, Cl- ×1". */
  ions: string[];
  hydrogens: number;
  symbols: string[];
  particles: number;
}

function inspect(mol: Molecule): Evidence {
  const ev: Evidence = {
    alcoholO: [],
    phenolO: [],
    oxoacidOH: [],
    carboxylC: [],
    aldehydeC: [],
    ketoneC: [],
    esterC: [],
    nitrileAcid: [],
    etherO: [],
    amineN: [],
    aromatic: 0,
    aromaticAtoms: new Set<number>(),
    rings: ringCount(mol),
    peroxide: false,
    cations: 0,
    anions: 0,
    hydroxideAnions: 0,
    oxideAnions: 0,
    simpleAnions: 0,
    polyatomicAnions: 0,
    ammonia: false,
    ions: [],
    hydrogens: 0,
    symbols: [...symbolCounts(mol).keys()],
    particles: components(mol).length,
  };

  for (const atom of mol.atoms) {
    ev.hydrogens += atom.hydrogens;
    if (atom.charge > 0) ev.cations++;
    if (atom.charge < 0) {
      ev.anions++;
      if (bondedOrder(mol, atom.index) > 0) {
        ev.polyatomicAnions++;
      } else if (atom.symbol !== "O") {
        ev.simpleAnions++;
      } else if (atom.hydrogens > 0) {
        ev.hydroxideAnions++;
      } else {
        ev.oxideAnions++;
      }
    }
  }
  const tally = new Map<string, number>();
  for (const atom of mol.atoms) {
    if (atom.charge === 0) continue;
    const label = `${atom.symbol}${atom.charge > 0 ? "+" : "-"}${Math.abs(atom.charge)}`;
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  ev.ions = [...tally].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));

  const aromaticRings = ringsOfSize(mol, 6).filter((ring) => {
    const hetero = ring.map((index) => mol.atoms[index]!.symbol).filter((symbol) => symbol !== "C");
    if (hetero.length > 1) return false;
    if (hetero.length === 1 && hetero[0] !== "N") return false;
    let doubles = 0;
    for (const bond of mol.bonds) {
      if (bond.order === 2 && ring.includes(bond.a) && ring.includes(bond.b)) doubles++;
    }
    return doubles >= 3;
  });
  ev.aromatic = aromaticRings.length;
  for (const ring of aromaticRings) for (const index of ring) ev.aromaticAtoms.add(index);

  ev.peroxide = mol.bonds.some(
    (bond) =>
      bond.order === 1 &&
      mol.atoms[bond.a]!.symbol === "O" &&
      mol.atoms[bond.b]!.symbol === "O",
  );

  // carbons first: a carboxyl has to be known before its –OH is read as an alcohol
  for (const atom of mol.atoms) {
    if (atom.symbol !== "C") continue;
    const oxygen = doubleBondPartner(mol, atom.index, "O");
    if (oxygen === undefined) continue;
    const around = neighbors(mol, atom.index);
    const hydroxyl = around.find((n) => {
      const other = mol.atoms[n]!;
      return other.symbol === "O" && other.hydrogens > 0;
    });
    if (hydroxyl !== undefined) {
      // –COOH with a carbon (or a hydrogen) alongside: a carboxyl. With a
      // second –OH it is an oxoacid instead — carbonic acid, H2CO3.
      const rGroup = around.some((n) => mol.atoms[n]!.symbol === "C") || atom.hydrogens > 0;
      if (rGroup) ev.carboxylC.push(atom.index);
      continue;
    }
    const esterO = around.find((n) => {
      const other = mol.atoms[n]!;
      if (other.symbol !== "O" || other.hydrogens > 0) return false;
      // an ester oxygen bridges the carbonyl to a *different* carbon; without
      // that test every C=O would read as an ester, CO2 included
      return neighbors(mol, n).some((m) => m !== atom.index && mol.atoms[m]!.symbol === "C");
    });
    if (esterO !== undefined) {
      ev.esterC.push(atom.index);
      continue;
    }
    if (atom.hydrogens > 0) {
      ev.aldehydeC.push(atom.index);
      continue;
    }
    if (around.filter((n) => mol.atoms[n]!.symbol === "C").length >= 2) ev.ketoneC.push(atom.index);
  }

  // a nitrile whose carbon still holds a hydrogen is a very weak acid: HCN
  for (const atom of mol.atoms) {
    if (atom.symbol !== "C" || atom.hydrogens === 0) continue;
    if (neighbors(mol, atom.index).some((n) => bondedOrderBetween(mol, atom.index, n) === 3)) {
      ev.nitrileAcid.push(atom.index);
    }
  }

  for (const atom of mol.atoms) {
    if (atom.symbol === "O") {
      if (atom.charge !== 0) continue; // a free oxide or hydroxide is an ion, not a group
      const around = neighbors(mol, atom.index);
      if (atom.hydrogens > 0) {
        if (around.length !== 1) continue;
        const host = mol.atoms[around[0]!]!;
        if (host.symbol === "O") continue; // H–O–O is a peroxide, not an acid
        if (host.symbol !== "C") {
          ev.oxoacidOH.push(atom.index);
        } else if (ev.carboxylC.includes(host.index)) {
          // already counted as a carboxylic acid
        } else if (doubleBondPartner(mol, host.index, "O") !== undefined) {
          ev.oxoacidOH.push(atom.index); // –C(=O)OH with no carbon or hydrogen R: an oxoacid
        } else if (ev.aromaticAtoms.has(host.index)) {
          ev.phenolO.push(atom.index);
        } else {
          ev.alcoholO.push(atom.index);
        }
        continue;
      }
      if (around.length === 2) {
        const onCarbon = around.filter((n) => mol.atoms[n]!.symbol === "C");
        if (onCarbon.length !== 2) continue;
        // an ester oxygen is part of the ester, not an ether
        if (around.some((n) => doubleBondPartner(mol, n, "O") !== undefined)) continue;
        ev.etherO.push(atom.index);
      }
      continue;
    }
    if (atom.symbol === "N" && atom.charge === 0) {
      const around = neighbors(mol, atom.index);
      const bonded = around.map((n) => mol.atoms[n]!);
      if (bonded.some((other) => other.symbol === "O")) continue; // an oxide, a nitro
      if (around.some((n) => bondedOrderBetween(mol, atom.index, n) > 1)) continue; // a nitrile, an imine
      if (bonded.some((other) => other.symbol === "C" && doubleBondPartner(mol, other.index, "O") !== undefined)) {
        continue; // an amide, not an amine
      }
      const kinds = new Set(bonded.map((other) => other.symbol));
      if (![...kinds].every((symbol) => symbol === "C" || symbol === "N")) continue;
      if (kinds.has("C")) ev.amineN.push(atom.index);
      else if (atom.hydrogens > 0) ev.ammonia = true; // NH3, N2H4, and their relatives
    }
  }
  return ev;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * A formula with one element and no hydrogen is a simple substance. A metal one
 * is also, and more usefully, a metal — the sample is the element itself rather
 * than a compound of it.
 */
function addSimpleSubstance(out: Findings, symbol: string): void {
  if (isMetal(symbol)) {
    out.add("metal", `${symbol} on its own, a metal element rather than a compound of it`);
    out.add("element", `nothing but ${symbol}, so a sample of it is a simple substance`);
  } else {
    out.add("element", `nothing but ${symbol}, so a sample of it is a simple substance`);
  }
}

/** Runs every class rule against the built structure, in specificity order. */
function classifyStructure(mol: Molecule, formula: string, waters: number): Findings {
  const ev = inspect(mol);
  const out = new Findings();
  const hydrogens = ev.hydrogens;
  const carbon = ev.symbols.includes("C");
  const oxygen = ev.symbols.includes("O");
  const otherSymbols = ev.symbols.filter((symbol) => symbol !== "O");

  if (formula === "H2O") {
    out.add("water", "H2O exactly: two hydrogens on one oxygen");
    return out;
  }
  if (waters > 0) {
    out.add(
      "hydrate",
      `${plural(waters, "water molecule", "water molecules")} of crystallisation attached to the rest`,
    );
  }
  if (ev.carboxylC.length > 0) {
    out.add(
      "carboxylic-acid",
      `C with both a double-bonded O and an –OH: ${plural(ev.carboxylC.length, "carboxyl group", "carboxyl groups")}`,
    );
    out.add("acid", "the carboxyl's –OH can give up its hydrogen, so the species is an acid");
  }
  if (ev.oxoacidOH.length > 0) {
    out.add(
      "acid",
      `${plural(ev.oxoacidOH.length, "hydroxyl", "hydroxyls")} on oxygen bonded to ${otherSymbols.join("/")}: ` +
        "an oxoacid, ionisable in water",
    );
  }
  if (!carbon && !oxygen && ev.symbols.length === 1 && hydrogens > 0) {
    const symbol = ev.symbols[0]!;
    if (isHalogen(symbol) || isChalcogen(symbol)) {
      out.add(
        "acid",
        `${symbol} and hydrogen with no oxygen: a binary hydride that splits into H⁺ and ${symbol}⁻ in water`,
      );
    }
  }
  if (ev.nitrileAcid.length > 0) {
    out.add(
      "acid",
      "H on a carbon that also carries a triple-bonded N (–C≡N–H): a very weak acid, HCN being the one that matters",
    );
  }
  if (ev.aldehydeC.length > 0) {
    out.add(
      "aldehyde",
      `C=O whose carbon still carries H: ${plural(ev.aldehydeC.length, "-CHO group", "-CHO groups")}`,
    );
  }
  if (ev.ketoneC.length > 0) {
    out.add(
      "ketone",
      `C=O between two carbons: ${plural(ev.ketoneC.length, "carbonyl", "carbonyls")} with no H or –OH on it`,
    );
  }
  if (ev.esterC.length > 0) {
    out.add(
      "ester",
      `C=O whose carbon also carries –O–C: ${plural(ev.esterC.length, "ester group", "ester groups")}`,
    );
  }
  if (ev.alcoholO.length > 0) {
    out.add(
      "alcohol",
      `O–H on a saturated carbon outside any aromatic ring: ${plural(ev.alcoholO.length, "hydroxyl", "hydroxyls")}`,
    );
  }
  if (ev.phenolO.length > 0) {
    out.add(
      "alcohol",
      `O–H on a ring carbon: ${plural(ev.phenolO.length, "phenol group", "phenol groups")}, which is a phenol rather than an alcohol`,
    );
  }
  if (ev.etherO.length > 0) {
    out.add(
      "ether",
      `O with two single bonds, both to carbon, no H: ${plural(ev.etherO.length, "C–O–C linkage", "C–O–C linkages")}`,
    );
  }
  if (ev.amineN.length > 0) {
    out.add(
      "amine",
      `N with only single bonds and nothing bonded to oxygen: ${plural(ev.amineN.length, "amine nitrogen", "amine nitrogens")}, a weak Brønsted base`,
    );
  }
  if (ev.aromatic > 0) {
    out.add(
      "aromatic",
      `six-membered ring with three double bonds inside: ${plural(ev.aromatic, "aromatic ring", "aromatic rings")}`,
    );
  }
  if (carbon && ev.symbols.length === 1) {
    out.add(
      "hydrocarbon",
      `carbon and hydrogen and no other element, ${ev.rings === 0 ? "no rings" : plural(ev.rings, "ring", "rings")} in the structure`,
    );
  }
  if (ev.hydroxideAnions > 0) {
    out.add(
      "base",
      `${plural(ev.hydroxideAnions, "free OH⁻ anion", "free OH⁻ anions")}: it gives hydroxide in water`,
    );
  } else if (ev.ammonia) {
    out.add(
      "base",
      "nitrogen carrying nothing but hydrogens and other nitrogens: ammonia and hydrazine take a proton",
    );
  }
  if (ev.hydroxideAnions > 0) {
    out.add(
      "hydroxide",
      `${plural(ev.hydroxideAnions, "O–H group", "O–H groups")} with no carbon attached: hydroxide, not an organic –OH`,
    );
  }
  // a salt needs an anion that is not itself an oxide, in its own particle:
  // NaCl and K2SO4 are salts, Na2O and Fe2O3 are oxides, and a zwitterion such
  // as a nitro group is neither
  if (ev.cations > 0 && ev.particles > 1 && ev.simpleAnions + ev.polyatomicAnions > 0) {
    out.add(
      "salt",
      `cations and anions in ${plural(ev.particles, "particle", "particles")} — ${ev.ions.join(", ")}: a salt`,
    );
  }
  if (ev.peroxide) {
    out.add("peroxide", "an O–O single bond: a peroxide link rather than separate oxide ions");
  }
  if (oxygen && otherSymbols.length > 0 && hydrogens === 0 && ev.polyatomicAnions === 0) {
    out.add(
      "oxide",
      `oxygen with no hydrogen and no polyatomic anion: an oxide of ${otherSymbols.join("/")}`,
    );
  }
  if (ev.symbols.length === 1 && hydrogens === 0) {
    addSimpleSubstance(out, ev.symbols[0]!);
  }
  return out;
}

/** Everything a formula can honestly say on its own, with no connectivity. */
function classifyFormulaOnly(formula: string, waters: number): Findings {
  const out = new Findings();
  const counts = parseFormula(formula).elements;
  const hydrogens = counts.get("H") ?? 0;
  if (formula === "H2O") {
    out.add("water", "H2O exactly: two hydrogens on one oxygen");
    return out;
  }
  if (waters > 0) {
    out.add(
      "hydrate",
      `${plural(waters, "water molecule", "water molecules")} of crystallisation, read from the formula`,
    );
  }
  if (formula === "H2O2") {
    out.add("peroxide", "H2O2: two oxygens to two hydrogens, the peroxide formula");
  }
  // a simple substance: one element and nothing else. H2 has no heavy atom to
  // build a graph from, but "one element" is still something the formula knows.
  const onlySymbol = counts.size === 1 ? [...counts.keys()][0] : undefined;
  if (onlySymbol !== undefined && (onlySymbol === "H" || hydrogens === 0)) {
    addSimpleSubstance(out, onlySymbol);
  }
  return out;
}

/** How many water molecules the input's `·` parts ask for, hydrates included. */
function waterParts(input: string): number {
  return input
    .split("·")
    .map((part) => part.trim())
    .filter((part) => /^(?:(\d+))?H2O$/i.test(part))
    .reduce((sum, part) => sum + (Number(/^(\d+)/.exec(part)?.[1] ?? "1") || 1), 0);
}

/**
 * Classifies a formula, throwing only when the input is not a formula at all —
 * a user error, not a chemistry unknown.
 */
export function classify(input: string): Classification {
  const build = buildStructure(input);
  const waters = waterParts(build.input);
  const fromStructure = build.molecule !== null;
  const found = fromStructure
    ? classifyStructure(build.molecule!, build.formula, waters)
    : classifyFormulaOnly(build.formula, waters);

  const caveats: string[] = [];
  if (!fromStructure) {
    caveats.push("no connectivity could be built, so only the formula itself was classified");
  }
  const sharing = findTemplates(build.formula);
  if (sharing.length > 1) {
    caveats.push(
      `${build.formula} fits ${sharing.map((template) => template.name).join(" and ")} — the formula alone cannot choose`,
    );
  }
  return {
    input,
    formula: build.formula,
    primary: found.classes[0] ?? "unknown",
    classes: found.classes,
    reasoning: found.reasoning,
    caveats,
    fromStructure,
    structure: build,
    molarMass: molarMassFromCounts(parseFormula(build.formula).elements),
  };
}

/** Classification, or undefined when the input cannot be read as a formula. */
export function tryClassify(input: string): Classification | undefined {
  return tryBuildStructure(input) === undefined ? undefined : classify(input);
}
