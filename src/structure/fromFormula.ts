/**
 * Formula → connectivity, in three tiers, and never a guess dressed up as a
 * fact (plan §3: unknowns are surfaced, never invented).
 *
 *   Tier A `template`     — a curated exact structure (templates.ts)
 *   Tier B `constructed`  — connectivity inferred from valence rules, with the
 *                           formula's own hydrogen count as the budget
 *   Tier C `empirical`    — no connectivity at all: `molecule: null` plus a note
 *                           saying why. H2 is the plain case; a formula whose
 *                           atoms cannot be reconciled at all is the other
 *
 * The hydrogen budget is what makes Tier B honest. A formula states precisely
 * how many hydrogens it has, so the builder lays down heavy atoms joined by
 * single bonds and then asks how much spare valence is left:
 *
 *   spare < hydrogens  → the skeleton cannot hold them, give up
 *   spare = hydrogens  → fill them in, done
 *   spare > hydrogens  → the surplus is spent raising bond orders, substituents
 *                        before backbone bonds (a C=O, not a C=C in the chain);
 *                        if it cannot be spent, give up
 *
 * Every construction is checked against the formula it came from, and a
 * mismatch is discarded rather than shipped as a confident wrong answer.
 */
import { groupOf } from "../core/elements.ts";
import { formatFormula, parseFormula } from "../core/formula.ts";
import { mergeInto } from "./dsl.ts";
import {
  addAtom,
  addBond,
  bondedOrder,
  cloneMolecule,
  components,
  emptyMolecule,
  formulaString,
  type Molecule,
} from "./molecule.ts";
import { findTemplates } from "./templates.ts";
import { anionCharge, cationCharge, commonCharges, isMetal, preferredValence, valenceStates } from "./valence.ts";

export type BuildSource = "template" | "constructed" | "empirical";
export type BuildConfidence = "high" | "medium" | "low";

export interface StructureBuild {
  /** Exactly what the caller asked for, for echoing back. */
  input: string;
  /** Canonical Hill-order formula of the whole species, hydrate parts joined by ·. */
  formula: string;
  /** Connectivity, or null when only the empirical formula is known. */
  molecule: Molecule | null;
  source: BuildSource;
  confidence: BuildConfidence;
  /** Evidence and caveats. Never empty for a non-template build. */
  notes: string[];
}

/** Elements a constructed formal charge is allowed to sit on. */
const CHARGE_HOMES: ReadonlySet<string> = new Set([
  "O", "N", "S", "Se", "P", "Cl", "F", "Br", "I",
]);

/** How far an element may be pushed past its preferred valence to fit an atom. */
function maxValence(symbol: string): number {
  const states = valenceStates(symbol);
  return states.length > 0 ? states[states.length - 1]! : 0;
}

/** How many more bonds an atom can still accept. */
function spare(mol: Molecule, index: number, capacity: number): number {
  return capacity - bondedOrder(mol, index);
}

function totalSpare(mol: Molecule, capacities: number[]): number {
  return mol.atoms.reduce(
    (sum, atom) => sum + Math.max(0, spare(mol, atom.index, capacities[atom.index] ?? 0)),
    0,
  );
}

/**
 * Raises bond orders, `budget` steps at most, preferring bonds that leave the
 * backbone (a C=O before a C=C in the chain). Each step spends one spare
 * valence on *both* ends, and returns how many it managed — coming up short is
 * a result the caller has to reckon with, not an error.
 */
function upgradeBonds(mol: Molecule, budget: number, capacities: number[], backbone: ReadonlySet<number>): number {
  const isBackbone = (bond: { a: number; b: number }): number =>
    backbone.has(bond.a) && backbone.has(bond.b) ? 1 : 0;
  const candidates = [...mol.bonds].sort((x, y) => isBackbone(x) - isBackbone(y));
  let applied = 0;
  let progress = true;
  while (applied < budget && progress) {
    progress = false;
    for (const bond of candidates) {
      if (applied >= budget) break;
      if (bond.order >= 3) continue;
      if (spare(mol, bond.a, capacities[bond.a] ?? 0) < 1) continue;
      if (spare(mol, bond.b, capacities[bond.b] ?? 0) < 1) continue;
      bond.order = (bond.order + 1) as 2 | 3;
      applied++;
      progress = true;
    }
  }
  return applied;
}

/** Places exactly `budget` implicit hydrogens, filling atoms in index order. */
function placeHydrogens(mol: Molecule, budget: number, capacities: number[]): boolean {
  let left = budget;
  for (const atom of mol.atoms) {
    if (left === 0) return true;
    const room = Math.max(0, spare(mol, atom.index, capacities[atom.index] ?? 0));
    const take = Math.min(room, left);
    atom.hydrogens += take;
    left -= take;
  }
  return left === 0;
}

/**
 * Reconciles a single-bonded skeleton with the formula's hydrogen count,
 * spending any surplus valence on higher bond orders. Each upgrade costs two
 * spare valences, one at each end, so an odd surplus cannot be spent and the
 * build is refused. False means the numbers simply do not agree and the caller
 * must throw the build away.
 */
function reconcile(
  mol: Molecule,
  hydrogenBudget: number,
  capacities: number[],
  backbone: ReadonlySet<number>,
): boolean {
  const spareBefore = totalSpare(mol, capacities);
  if (spareBefore < hydrogenBudget) return false;
  if (spareBefore > hydrogenBudget) {
    upgradeBonds(mol, Math.ceil((spareBefore - hydrogenBudget) / 2), capacities, backbone);
  }
  if (totalSpare(mol, capacities) !== hydrogenBudget) return false;
  return placeHydrogens(mol, hydrogenBudget, capacities);
}

interface Construction {
  molecule: Molecule;
  confidence: BuildConfidence;
  notes: string[];
}

/** Tier B, one element and no hydrogen: atoms plus element-appropriate bonds. */
function constructElemental(symbol: string, count: number): Construction {
  const mol = emptyMolecule();
  if (count === 1) {
    addAtom(mol, symbol);
    return { molecule: mol, confidence: "high", notes: [`a single ${symbol} atom`] };
  }
  const capacity = Math.max(1, maxValence(symbol));
  const atoms: number[] = [];
  for (let i = 0; i < count; i++) atoms.push(addAtom(mol, symbol));
  if (count === 2) {
    // a diatomic gets the strongest bond its valence allows
    addBond(mol, atoms[0]!, atoms[1]!, Math.min(capacity, 3) as 1 | 2 | 3);
    return { molecule: mol, confidence: "medium", notes: [`${symbol}2 inferred as a diatomic`] };
  }
  if (capacity >= 2) {
    // a ring of single bonds: the shape most elemental solids actually take
    for (let i = 0; i < count; i++) addBond(mol, atoms[i]!, atoms[(i + 1) % count]!, 1);
    return {
      molecule: mol,
      confidence: "low",
      notes: [`${symbol}${count} inferred as a ring of single bonds — the real allotrope may differ`],
    };
  }
  for (let i = 0; i < count - 1; i++) addBond(mol, atoms[i]!, atoms[i + 1]!, 1);
  return {
    molecule: mol,
    confidence: "low",
    notes: [`${symbol}${count} inferred as a chain of single bonds`],
  };
}

/**
 * Tier B, the core of an oxoacid or oxyanion: one or more central atoms X
 * carrying `oxygenCount` oxygens. Every oxygen starts on a single bond and is
 * raised to a double bond wherever its centre has the valence to spare, except
 * that at least `minimumSingles` are left single-bonded, because that is where
 * a hydroxyl has to sit.
 *
 * This is what real oxoanions do: sulfate is two S=O and two S–O⁻, nitrate two
 * N=O and one N–O⁻, phosphate one P=O and three P–OH, bicarbonate one C=O, one
 * C–OH and one C–O⁻. Two centres, as in Cr2O7²⁻, are bonded to each other and
 * the oxygens spread across them.
 */
function buildOxoCore(
  centrals: ReadonlyArray<{ symbol: string; count: number }>,
  oxygenCount: number,
  minimumSingles: number,
): { mol: Molecule; singles: number[] } {
  const mol = emptyMolecule();
  const capacities: number[] = [];
  const centres: number[] = [];
  for (const { symbol, count } of centrals) {
    for (let i = 0; i < count; i++) {
      const index = addAtom(mol, symbol);
      capacities[index] = maxValence(symbol);
      centres.push(index);
    }
  }
  for (let i = 1; i < centres.length; i++) addBond(mol, centres[i - 1]!, centres[i]!, 1);
  const singles: number[] = [];
  for (let i = 0; i < oxygenCount; i++) {
    // the roomiest centre takes it, earliest wins a tie
    let best = 0;
    for (let j = 1; j < centres.length; j++) {
      if (spare(mol, centres[j]!, capacities[j]!) > spare(mol, centres[best]!, capacities[best]!)) best = j;
    }
    const o = addAtom(mol, "O");
    capacities[o] = preferredValence("O");
    addBond(mol, centres[best]!, o, 1);
    singles.push(o);
  }
  for (let i = 0; i < singles.length; i++) {
    if (singles.length - i <= minimumSingles) break;
    const bond = mol.bonds.find((b) => b.a === singles[i] || b.b === singles[i]);
    if (bond === undefined) continue;
    const host = bond.a === singles[i] ? bond.b : bond.a;
    if (spare(mol, host, capacities[host] ?? 0) < 1) continue;
    bond.order = 2;
    singles.splice(i, 1);
    i--;
  }
  return { mol, singles };
}

/**
 * Spreads `charge` over the fragment's least-loaded terminal atoms — where a
 * formal charge belongs — and reports when the leftover had to sit on the
 * first atom instead. Hydroxyl oxygens are homes too, though only as a last
 * resort: an O carrying a hydrogen *is* a hydroxide ion when nothing else is
 * left to charge, and Fe(OH)3 has no other oxygen to put the charge on.
 */
function assignFragmentCharge(mol: Molecule, charge: number): string | undefined {
  if (charge === 0) return undefined;
  const step = charge > 0 ? 1 : -1;
  let left = Math.abs(charge);
  const unprotonated = mol.atoms
    .filter((atom) => atom.charge === 0 && atom.hydrogens === 0 && CHARGE_HOMES.has(atom.symbol))
    .sort((a, b) => bondedOrder(mol, a.index) - bondedOrder(mol, b.index));
  for (const atom of unprotonated) {
    if (left === 0) break;
    atom.charge += step;
    left--;
  }
  for (const atom of mol.atoms) {
    if (left === 0) break;
    if (atom.charge === 0 && atom.hydrogens > 0 && CHARGE_HOMES.has(atom.symbol)) {
      atom.charge += step;
      left--;
    }
  }
  if (left > 0) {
    mol.atoms[0]!.charge += step * left;
    return `the last ${left} of the charge had to go onto an atom that was already charged`;
  }
  return undefined;
}

/**
 * How many copies of one anion unit the non-metal counts hold. `Ba(NO3)2` is two
 * nitrates, not one BaN2O6 blob: the largest `k` that divides both the charge the
 * anions have to carry and every non-metal count is the repeat count. Monoatomic
 * anions are never repeated — two oxides in a formula may well be one peroxide.
 */
function anionRepeats(rest: ReadonlyMap<string, number>, wanted: number): number {
  const counts = [...rest.values()];
  if (new Set(rest.keys()).size < 2) return 1;
  const smallest = Math.min(...counts);
  for (let k = Math.min(smallest, Math.abs(wanted)); k >= 2; k--) {
    if (wanted % k === 0 && counts.every((n) => n % k === 0)) return k;
  }
  return 1;
}

/**
 * The charge the anion is *known* to carry, when the formula settles it on its
 * own: a monoatomic ion (O²⁻, Cl⁻, S²⁻), a hydride, or a run of free
 * hydroxides — every O–H is one OH⁻, which is what puts Fe(OH)3 at Fe³⁺. Null
 * when the anion is polyatomic, because then the charge is whatever the
 * cations need it to be.
 */
function knownAnionCharge(unit: ReadonlyMap<string, number>): number | null {
  const symbols = [...unit.keys()].filter((s) => s !== "H");
  if (symbols.length === 1 && (unit.get("H") ?? 0) === 0) {
    const q = anionCharge(symbols[0]!);
    return q === 0 ? null : (unit.get(symbols[0]!) ?? 0) * q;
  }
  if (symbols.length === 0 && (unit.get("H") ?? 0) > 0) {
    return (unit.get("H") ?? 0) * anionCharge("H");
  }
  if (symbols.length === 1 && symbols[0] === "O") {
    const oxygens = unit.get("O") ?? 0;
    const hydrogens = unit.get("H") ?? 0;
    if (hydrogens > 0 && hydrogens <= oxygens) return -hydrogens;
  }
  return null;
}

/**
 * Charge per metal ion. When the anion's charge is known the metals have to
 * balance it, so CuO comes out Cu²⁺ + O²⁻ rather than the cuprous charge Cu
 * happens to list first. When nothing is known, a polyatomic anion is the only
 * thing that can decide: `Cu(NO3)2` only divides into two nitrates if copper is
 * +2, so the charge that makes the anion come out in whole copies wins. A
 * charge no common ion of that metal can carry is not invented: the preferred
 * one is used and the imbalance gets reported.
 */
function cationChargeFor(
  metal: string,
  metalCount: number,
  known: number | null,
  rest: ReadonlyMap<string, number>,
): number {
  if (known !== null && known < 0) {
    const needed = -known / metalCount;
    if (Number.isInteger(needed) && needed > 0 && commonCharges(metal).includes(needed)) {
      return needed;
    }
  }
  const charges = commonCharges(metal).filter((q) => q > 0);
  if (known === null && charges.length > 1) {
    let best = cationCharge(metal);
    let bestRepeats = anionRepeats(rest, -best * metalCount);
    for (const q of charges) {
      const repeats = anionRepeats(rest, -q * metalCount);
      if (repeats > bestRepeats) {
        best = q;
        bestRepeats = repeats;
      }
    }
    return best;
  }
  return cationCharge(metal);
}

/**
 * The metals in a salt that are the centre of an oxyanion rather than free
 * cations. `KMnO4` is K⁺ and MnO₄⁻, not K⁺, Mn⁴⁺ and four stray oxides, so a
 * metal wrapped in oxygen next to an alkali counter-ion becomes the anion's
 * core. Alkali and alkaline-earth metals are always cations, and a metal
 * standing next to other non-metals (Al in Al2(SO4)3) is one too.
 */
function oxyanionCentres(metals: readonly string[], counts: ReadonlyMap<string, number>): string[] {
  const counterIons = metals.filter((metal) => {
    const group = groupOf(metal);
    return group === 1 || group === 2;
  });
  if (counterIons.length === 0) return [];
  const candidates = metals.filter((metal) => !counterIons.includes(metal));
  if (candidates.length !== 1) return [];
  const centre = candidates[0]!;
  const others = new Map(
    [...counts].filter(([symbol]) => symbol !== centre && !counterIons.includes(symbol)),
  );
  if ([...others.keys()].some((symbol) => symbol !== "H" && symbol !== "O")) return [];
  const oxygens = others.get("O") ?? 0;
  if (oxygens < 2) return [];
  return oxygens >= 2 * (counts.get(centre) ?? 1) ? [centre] : [];
}

/** Tier B, a salt: metal cations plus one or more anions carrying the balance. */
function constructSalt(
  counts: ReadonlyMap<string, number>,
  metals: readonly string[],
  hydrogenBudget: number,
): Construction | null {
  const notes: string[] = [];
  const mol = emptyMolecule();
  const centres = oxyanionCentres(metals, counts);
  const cations = metals.filter((metal) => !centres.includes(metal));
  const rest = new Map([...counts].filter(([sym]) => !cations.includes(sym)));
  const restSymbols = [...rest.keys()].filter((s) => s !== "H");
  const known = knownAnionCharge(rest);
  const metalCount = cations.reduce((sum, metal) => sum + (counts.get(metal) ?? 0), 0);
  const charges = new Map(
    cations.map((metal) => [metal, cationChargeFor(metal, metalCount, known, rest)]),
  );

  let chargeTotal = 0;
  for (const metal of cations) {
    const q = charges.get(metal) ?? 0;
    if (q === 0) return null; // no known cation state: not our call to make one up
    for (let i = 0; i < (counts.get(metal) ?? 0); i++) {
      addAtom(mol, metal, { charge: q });
      chargeTotal += q;
    }
  }
  const wanted = -chargeTotal;
  const repeats = centres.length > 0 ? 1 : anionRepeats(rest, wanted);
  const unit = new Map([...rest].map(([symbol, n]) => [symbol, n / repeats]));
  const unitCharge = wanted / repeats;
  const unitHydrogens = hydrogenBudget / repeats;
  let anion: Molecule;
  let chargeNote: string | undefined;

  if (centres.length > 0) {
    // the metal is the core of an oxyanion, e.g. permanganate or dichromate
    const centre = centres[0]!;
    const { mol: core, singles } = buildOxoCore(
      [{ symbol: centre, count: unit.get(centre) ?? 1 }],
      unit.get("O") ?? 0,
      unitHydrogens,
    );
    anion = core;
    notes.push(
      `anion: a ${centre} core with ${unit.get("O")} oxygen(s)` +
        (unitHydrogens > 0 ? `, ${unitHydrogens} hydroxyl(s)` : "") +
        " — the metals are read as one oxyanion rather than as free ions",
    );
    chargeNote = assignFragmentCharge(anion, unitCharge);
  } else if (restSymbols.length === 0) {
    // a hydride: hydrogen is the only thing left to be the anion, e.g. NaH
    const hydrogens = unit.get("H") ?? 0;
    if (hydrogens === 0 || anionCharge("H") === 0) return null;
    anion = emptyMolecule();
    for (let i = 0; i < hydrogens; i++) addAtom(anion, "H", { charge: anionCharge("H") });
    if (hydrogens * anionCharge("H") !== wanted) {
      notes.push(`${hydrogens} hydride(s) of charge ${anionCharge("H")} do not balance the cations`);
    }
  } else if (restSymbols.length === 1 && unitHydrogens === 0) {
    const symbol = restSymbols[0]!;
    const count = unit.get(symbol) ?? 0;
    const q = Math.sign(unitCharge) * Math.abs(anionCharge(symbol));
    anion = emptyMolecule();
    if (q !== 0 && count * q === unitCharge) {
      for (let i = 0; i < count; i++) addAtom(anion, symbol, { charge: q });
    } else {
      // no common ion fits: keep the atoms neutral and spread the charge. Two
      // bonded ones give peroxide (O2²⁻) and superoxide (O2⁻) their real shapes,
      // and NaCl2-type formulas get said out loud instead of quietly fudged.
      const atoms: number[] = [];
      for (let i = 0; i < count; i++) atoms.push(addAtom(anion, symbol));
      if (count === 2) addBond(anion, atoms[0]!, atoms[1]!, 1);
      const spread = assignFragmentCharge(anion, unitCharge);
      if (spread !== undefined) notes.push(spread);
      notes.push(
        `${count} ${symbol} atom(s) would have to carry ${unitCharge} between them, which is not ` +
          `the charge of any common ${symbol} ion` +
          (count === 2 ? " — they are modelled as a bonded pair" : "") +
          ", with the charge spread over them one step at a time",
      );
    }
  } else {
    // the anion is built neutral, so its share of the charge is still to come
    const built = buildAnion(unit, unitHydrogens);
    if (built === null) return null;
    anion = built.molecule;
    notes.push(...built.notes);
    chargeNote = assignFragmentCharge(anion, unitCharge);
  }
  if (chargeNote !== undefined) notes.push(chargeNote);
  mergeInto(mol, anion);
  for (let i = 1; i < repeats; i++) mergeInto(mol, cloneMolecule(anion));
  if (repeats > 1) notes.push(`${repeats} × ${anionLabel(anion)} anions`);
  notes.unshift(
    `salt: ${cations.join(" / ")} cation(s) with a constructed anion — the formula fixes the charges, not the shape`,
  );
  return { molecule: mol, confidence: "medium", notes };
}

/**
 * The anion's own formula with its hub element leading, so the note reads "PO4"
 * the way chemistry writes it rather than Hill's "O4P".
 */
function anionLabel(anion: Molecule): string {
  const hub = anion.atoms.reduce((a, b) => (bondedOrder(anion, b.index) > bondedOrder(anion, a.index) ? b : a));
  const rest = new Map<string, number>();
  for (const atom of anion.atoms) {
    if (atom.index === hub.index) continue;
    rest.set(atom.symbol, (rest.get(atom.symbol) ?? 0) + 1);
  }
  const tally = (n: number): string => (n > 1 ? String(n) : "");
  const tail = [...rest]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([symbol, n]) => symbol + tally(n))
    .join("");
  return `${hub.symbol}${tally((rest.get(hub.symbol) ?? 0) + 1)}${tail}`;
}

/** Tier B, the anion half of a salt, built from its non-metal atoms. */
function buildAnion(rest: ReadonlyMap<string, number>, hydrogenBudget: number): Construction | null {
  const notes: string[] = [];
  const symbols = [...rest.keys()].filter((s) => s !== "H");
  const oxygens = rest.get("O") ?? 0;
  const others = symbols.filter((s) => s !== "O");

  if (others.length === 0 && oxygens > 0 && hydrogenBudget <= oxygens) {
    // nothing but oxygen and hydrogen left: the anions are free hydroxides,
    // the NaOH half of sodium hydroxide
    const mol = emptyMolecule();
    const freeOxygens: number[] = [];
    for (let i = 0; i < oxygens; i++) freeOxygens.push(addAtom(mol, "O"));
    for (let i = 0; i < hydrogenBudget; i++) mol.atoms[freeOxygens[i]!]!.hydrogens = 1;
    return {
      molecule: mol,
      confidence: "medium",
      notes: [
        `anion: ${oxygens} separate hydroxide ion(s), ` +
          `${hydrogenBudget} of them protonated — an ion, not a bonded group`,
      ],
    };
  }

  if (others.length === 1 && oxygens > 0) {
    const central = others[0]!;
    const count = rest.get(central) ?? 1;
    const { mol, singles } = buildOxoCore([{ symbol: central, count }], oxygens, hydrogenBudget);
    if (hydrogenBudget > singles.length) return null; // no room for that many hydroxyls
    for (let i = 0; i < hydrogenBudget; i++) mol.atoms[singles[i]!]!.hydrogens = 1;
    return {
      molecule: mol,
      confidence: "medium",
      notes: [
        `anion: a ${central} centre with ${oxygens} oxygen(s)` +
          (hydrogenBudget > 0 ? `, ${hydrogenBudget} hydroxyl(s)` : "") +
          ", the balance left to the cation charge",
      ],
    };
  }

  // anything else: a plain chain of the non-metal atoms, reconciled by hydrogen
  const chain = buildChain(rest);
  if (chain === null) return null;
  if (!reconcile(chain.molecule, hydrogenBudget, chain.capacities, chain.backbone)) return null;
  return { molecule: chain.molecule, confidence: "low", notes };
}

/**
 * Joins every non-hydrogen atom of `counts` into one chain, hanging each new
 * atom off the most recently added atom that still has room. Returns null when
 * even that runs out of valence.
 */
function buildChain(counts: ReadonlyMap<string, number>): {
  molecule: Molecule;
  capacities: number[];
  backbone: Set<number>;
} | null {
  const mol = emptyMolecule();
  const capacities: number[] = [];
  const backbone = new Set<number>();
  for (const [symbol, count] of counts) {
    if (symbol === "H") continue;
    for (let i = 0; i < count; i++) {
      const index = addAtom(mol, symbol);
      capacities[index] = preferredValence(symbol);
      backbone.add(index);
    }
  }
  if (mol.atoms.length === 0) return null;
  for (let i = 1; i < mol.atoms.length; i++) {
    const host = mol.atoms
      .slice(0, i)
      .reverse()
      .find((atom) => spare(mol, atom.index, capacities[atom.index] ?? 0) > 0);
    if (host === undefined) return null;
    addBond(mol, host.index, mol.atoms[i]!.index, 1);
  }
  return { molecule: mol, capacities, backbone };
}

/**
 * Tier B, carbon skeleton: every C in a chain, the rest as substituents.
 * Substituents go to the carbon with the most room (earliest wins a tie) so that
 * C3H6O3 spreads its oxygens one per carbon instead of stacking them all on the
 * end, which would then not reconcile.
 */
function constructOrganic(counts: ReadonlyMap<string, number>, carbons: number): Construction | null {
  const mol = emptyMolecule();
  const capacities: number[] = [];
  const chain: number[] = [];
  for (let i = 0; i < carbons; i++) {
    const c = addAtom(mol, "C");
    capacities[c] = preferredValence("C");
    if (chain.length > 0) addBond(mol, chain[chain.length - 1]!, c, 1);
    chain.push(c);
  }
  if (carbons === 0) return null;
  for (const [symbol, count] of counts) {
    if (symbol === "C" || symbol === "H") continue;
    for (let i = 0; i < count; i++) {
      const hosts = chain.map((c) => spare(mol, c, capacities[c] ?? 0));
      const roomiest = hosts.indexOf(Math.max(...hosts));
      if (roomiest < 0 || hosts[roomiest]! <= 0) return null; // no carbon with room left
      const child = addAtom(mol, symbol);
      capacities[child] = preferredValence(symbol);
      addBond(mol, chain[roomiest]!, child, 1);
    }
  }
  const hydrogens = counts.get("H") ?? 0;
  if (!reconcile(mol, hydrogens, capacities, new Set(chain))) return null;
  return {
    molecule: mol,
    confidence: "medium",
    notes: ["constructed: a carbon chain with the remaining atoms as substituents — no rings are inferred"],
  };
}

/**
 * Tier B, an ammonium salt: `NH4+` is a cation even though nitrogen is not a
 * metal, so `NH4OH` is ammonium plus a free hydroxide and `(NH4)2CO3` is two
 * ammoniums plus a carbonate. Only fires when every hydrogen belongs to a
 * nitrogen four of them to a piece, which keeps ammonia, hydrazine, urea and
 * methylamine out of it.
 */
function constructAmmonium(
  counts: ReadonlyMap<string, number>,
  nitrogens: number,
  hydrogens: number,
): Construction | null {
  const anion = buildAnion(
    new Map([...counts].filter(([symbol]) => symbol !== "N")),
    hydrogens - 4 * nitrogens,
  );
  if (anion === null) return null;
  const mol = emptyMolecule();
  for (let i = 0; i < nitrogens; i++) addAtom(mol, "N", { charge: 1, hydrogens: 4 });
  const chargeNote = assignFragmentCharge(anion.molecule, -nitrogens);
  mergeInto(mol, anion.molecule);
  const notes = [`ammonium: ${nitrogens} NH4+ cation(s) with a constructed anion`, ...anion.notes];
  if (chargeNote !== undefined) notes.push(chargeNote);
  return { molecule: mol, confidence: "medium", notes };
}

/** Tier B dispatcher: picks a construction strategy from the composition. */
function construct(counts: ReadonlyMap<string, number>): Construction | null {
  const symbols = [...counts.keys()];
  const hydrogens = counts.get("H") ?? 0;
  const heavies = symbols.filter((s) => s !== "H");
  if (heavies.length === 0) return null; // pure hydrogen has no heavy-atom graph

  if (heavies.length === 1 && hydrogens === 0) {
    // a lone metal is a metal lattice, not an ion: report the atom, not a charge
    if (isMetal(heavies[0]!)) {
      const mol = emptyMolecule();
      addAtom(mol, heavies[0]!);
      return {
        molecule: mol,
        confidence: "low",
        notes: [
          `a single ${heavies[0]} atom — in the solid this is a metal lattice, which we do not model`,
        ],
      };
    }
    return constructElemental(heavies[0]!, counts.get(heavies[0]!)!);
  }

  const metals = heavies.filter((s) => isMetal(s));
  if (metals.length > 0) return constructSalt(counts, metals, hydrogens);

  // ammonium salts: four hydrogens per nitrogen is the giveaway, and any hydrogen
  // left over has to be able to sit on one of the remaining oxygens, so NH4OH
  // qualifies and glycine does not
  const nitrogens = counts.get("N") ?? 0;
  const leftover = hydrogens - 4 * nitrogens;
  if (nitrogens > 0 && leftover >= 0 && leftover <= (counts.get("O") ?? 0)) {
    const ammonium = constructAmmonium(counts, nitrogens, hydrogens);
    if (ammonium !== null) return ammonium;
  }

  if (counts.has("C")) return constructOrganic(counts, counts.get("C") ?? 0);

  const oxygens = counts.get("O") ?? 0;
  const others = heavies.filter((s) => s !== "O");
  if (oxygens > 0 && others.length === 1) {
    // oxoacid: a central atom, its oxygens, and hydrogens on the single-bonded ones
    const central = others[0]!;
    const { mol, singles } = buildOxoCore([{ symbol: central, count: 1 }], oxygens, hydrogens);
    if (hydrogens > singles.length) return null;
    for (let i = 0; i < hydrogens; i++) mol.atoms[singles[i]!]!.hydrogens = 1;
    return {
      molecule: mol,
      confidence: "medium",
      notes: [
        `constructed: a ${central} centre with ${oxygens} oxygen(s), ` +
          (hydrogens > 0 ? `${hydrogens} of them hydroxyls` : "none of them protonated") +
          " and the rest double-bonded",
      ],
    };
  }

  // last resort: a single chain of the heavy atoms, hydrogens filling the gaps
  const chain = buildChain(counts);
  if (chain === null) return null;
  if (!reconcile(chain.molecule, hydrogens, chain.capacities, chain.backbone)) return null;
  return {
    molecule: chain.molecule,
    confidence: "low",
    notes: ["constructed: a single chain of the heavy atoms — treat the connectivity as a guess"],
  };
}

/** Tier A/B/C for one formula part (hydrates are split before this). */
function buildPart(text: string, counts: ReadonlyMap<string, number>): StructureBuild {
  const key = formatFormula(counts);
  const curated = findTemplates(key);
  if (curated.length > 0) {
    const notes = [`curated structure: ${curated.map((t) => t.name).join(" / ")}`];
    if (curated.length > 1) {
      notes.push(`${key} is also ${curated[1]!.name} — the formula alone cannot choose between them`);
    }
    return {
      input: text,
      formula: key,
      molecule: curated[0]!.build(),
      source: "template",
      confidence: "high",
      notes,
    };
  }
  const built = construct(counts);
  if (built !== null && formulaString(built.molecule) === key) {
    return {
      input: text,
      formula: key,
      molecule: built.molecule,
      source: "constructed",
      confidence: built.confidence,
      notes: built.notes,
    };
  }
  const reason =
    built === null
      ? "no construction reconciles this formula's atoms with its hydrogen count"
      : `the natural construction came out as ${formulaString(built.molecule)}, a different formula`;
  return {
    input: text,
    formula: key,
    molecule: null,
    source: "empirical",
    confidence: "low",
    notes: [
      `no curated structure, and ${reason} — the empirical formula is all we know`,
      ...(built?.notes ?? []),
    ],
  };
}

interface Part {
  build: StructureBuild;
  /** How many copies the hydrate coefficient asks for. */
  copies: number;
}

/** One `·`-separated part: its element counts and its repeat count. */
function parsePart(text: string): Part {
  const withCoefficient = /^(\d+)([A-Za-z(].*)$/.exec(text);
  if (withCoefficient) {
    const copies = parseInt(withCoefficient[1]!, 10);
    if (copies < 1) throw new Error(`formula '${text}': a hydrate coefficient has to be at least 1`);
    return { build: buildPart(text, parseFormula(withCoefficient[2]!).elements), copies };
  }
  return { build: buildPart(text, parseFormula(text).elements), copies: 1 };
}

const CONFIDENCE_RANK: Readonly<Record<BuildConfidence, number>> = { high: 0, medium: 1, low: 2 };

/**
 * Builds the structure for a formula, hydrates included: each `·`-separated
 * part is built on its own and merged into one graph, so its components are the
 * particles and the notes say what was combined. `CuSO4·5H2O` therefore comes
 * back as seven particles: copper, sulfate and five waters.
 *
 * Throws only when the input is not a formula at all — that is a user error,
 * not a chemistry unknown.
 */
export function buildStructure(input: string): StructureBuild {
  const texts = input
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (texts.length === 0) throw new Error("empty formula");

  const parts = texts.map((text) => parsePart(text));
  const formula = parts
    .map((part) => (part.copies > 1 ? `${part.copies}${part.build.formula}` : part.build.formula))
    .join("·");
  const notes = parts.flatMap((part) => part.build.notes);
  if (parts.length > 1) {
    const waters = parts
      .filter((part) => part.build.formula === "H2O")
      .reduce((sum, part) => sum + part.copies, 0);
    notes.unshift(
      `hydrate: ${parts.length} formula part(s)${waters > 0 ? `, ${waters} water molecule(s) among them` : ""}`,
    );
  }
  if (parts.some((part) => part.build.molecule === null)) {
    const missing = parts
      .filter((part) => part.build.molecule === null)
      .map((part) => part.build.input);
    return {
      input,
      formula,
      molecule: null,
      source: "empirical",
      confidence: "low",
      notes: [...notes, `no connectivity for ${missing.join(", ")}`],
    };
  }
  const merged = emptyMolecule();
  for (const part of parts) {
    for (let i = 0; i < part.copies; i++) mergeInto(merged, part.build.molecule!);
  }
  return {
    input,
    formula,
    molecule: merged,
    source: parts.every((part) => part.build.source === "template") ? "template" : "constructed",
    confidence: parts.reduce<BuildConfidence>(
      (worst, part) =>
        CONFIDENCE_RANK[part.build.confidence] > CONFIDENCE_RANK[worst] ? part.build.confidence : worst,
      "high",
    ),
    notes,
  };
}

/** Structure of a formula, or undefined when the input cannot be read at all. */
export function tryBuildStructure(input: string): StructureBuild | undefined {
  try {
    return buildStructure(input);
  } catch {
    return undefined;
  }
}

/** Separate particles in the graph: 1 for a molecule, more for a salt. */
export function fragmentCount(build: StructureBuild): number {
  return build.molecule === null ? 0 : components(build.molecule).length;
}
