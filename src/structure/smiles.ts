/**
 * SMILES input: the interface, the registry, and the honest failure.
 *
 * M3 ships the *seam*, not the parser. A formula says which atoms are present
 * and in what number; it does not say how they are joined, so `C2H6O` is
 * ethanol and dimethyl ether at the same time. SMILES does say — which is why
 * it is worth having, and why a parser is a big enough piece of work to keep
 * behind an interface instead of in the box.
 *
 * The contract for whoever installs one:
 *
 * ```ts
 * setSmilesParser({
 *   name: "my-parser",
 *   parse: (input) => myMoleculeOrUndefined(input),
 * });
 * ```
 *
 * A parser returns the same `Molecule` graph the formula path builds, with
 * hydrogens implicit on the atoms, so everything downstream — classification,
 * the cards — reads one model. Nothing here throws: a missing parser, a parser
 * that declines the input, and a parser that throws all come back as the same
 * `SmilesResult`, because a bad input string is a user error the caller
 * reports, not a crash.
 *
 * `setSmilesParser` is the only mutable state in the codebase. It exists so a
 * host (the CLI, a plugin, a test) can install a parser once; the parsing
 * itself is pure, and `readSmiles` also takes a parser directly for callers
 * that would rather not touch the registry.
 */
import { formulaString, type Molecule } from "./molecule.ts";

/** A SMILES parser supplied from outside the engine. */
export interface SmilesParser {
  /** Name for the card and for error messages, e.g. "openchemlib". */
  readonly name: string;
  /**
   * Parses SMILES into the engine's graph model, or returns undefined when the
   * input is not SMILES this parser accepts. May throw for input it claims but
   * cannot read; `readSmiles` turns that into a `SmilesResult` too.
   */
  parse(input: string): Molecule | undefined;
}

/** What came back from a SMILES read: a graph, or a sentence saying why not. */
export type SmilesResult =
  | { ok: true; molecule: Molecule; formula: string; parser: string }
  | { ok: false; reason: string; parser: string | null };

let installed: SmilesParser | undefined;

/** Installs a parser process-wide, replacing any previous one. */
export function setSmilesParser(parser: SmilesParser | undefined): void {
  installed = parser;
}

/** The installed parser, if any. */
export function installedSmilesParser(): SmilesParser | undefined {
  return installed;
}

/** Removes the installed parser. */
export function clearSmilesParser(): void {
  installed = undefined;
}

/**
 * Reads SMILES into a molecule. Uses `parser` when given, otherwise the
 * installed one, and explains itself when there is nothing to parse with.
 */
export function readSmiles(input: string, parser?: SmilesParser): SmilesResult {
  const chosen = parser ?? installed;
  if (chosen === undefined) {
    return {
      ok: false,
      reason:
        "no SMILES parser is installed: this build ships the interface and the registry, " +
        "so a SMILES string cannot be read yet",
      parser: null,
    };
  }
  let molecule: Molecule | undefined;
  try {
    molecule = chosen.parse(input);
  } catch (error) {
    return {
      ok: false,
      reason: `${chosen.name} could not read it: ${error instanceof Error ? error.message : String(error)}`,
      parser: chosen.name,
    };
  }
  if (molecule === undefined) {
    return { ok: false, reason: `${chosen.name} did not recognise that as SMILES`, parser: chosen.name };
  }
  return { ok: true, molecule, formula: formulaString(molecule), parser: chosen.name };
}

/**
 * The formula a SMILES string stands for, or undefined when it cannot be read.
 * Feeding that to `classify` is the honest use of SMILES here: the connectivity
 * settles which isomer it is, and the formula is all the classifier needs from
 * there on.
 */
export function formulaFromSmiles(input: string, parser?: SmilesParser): string | undefined {
  const result = readSmiles(input, parser);
  return result.ok ? result.formula : undefined;
}
