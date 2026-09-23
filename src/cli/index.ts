#!/usr/bin/env node

import { balanceEquation, formatBalancedEquation } from "../core/balance.ts";
import { parseEquation } from "../core/equation.ts";
import { getElement } from "../core/elements.ts";
import { molarMassFromCounts } from "../core/formula.ts";

const VERSION = "0.1.0";

const USAGE = `ChemEngine v${VERSION}
Autonomous offline chemical simulation engine.

Usage:
  chem <command> [options]

Options:
  --help, -h     Show this help
  --version, -v  Print version

Commands:
  balance    Balance a chemical equation                     [M1]
  element    Query periodic table data                       [M1]
  classify   Classify a species (acid/base/salt/metal/...)   [M2 - planned]
  predict    Predict reactions from reactants                [M3 - planned]
  simulate   Simulate reaction kinetics                      [M4 - planned]
`;

function fail(message: string): void {
  console.error(`chem: ${message}`);
  process.exitCode = 1;
}

function cmdBalance(eq: string): void {
  if (!eq) {
    fail('usage: chem balance "<equation>"  (e.g. "CH4 + O2 -> CO2 + H2O")');
    return;
  }
  const parsed = parseEquation(eq);
  const balanced = balanceEquation(parsed);
  console.log(formatBalancedEquation(balanced));
  console.log();
  const species = [...balanced.equation.reactants, ...balanced.equation.products];
  const rows = species.map((sp, i) => {
    const coeff = balanced.coefficients[i]!;
    const mass = molarMassFromCounts(sp.counts);
    return `  ${coeff} x ${sp.formula.padEnd(12)} ${sp.state ? `(${sp.state}) ` : ""}${mass.toFixed(3)} g/mol`;
  });
  console.log("Stoichiometry:");
  console.log(rows.join("\n"));
  console.log(`\nConserved elements: ${balanced.elements.join(", ")}`);
}

function cmdElement(symbol: string): void {
  if (!symbol) {
    fail('usage: chem element <symbol>  (e.g. "O")');
    return;
  }
  const el = getElement(symbol);
  console.log(`  ${el.symbol.padEnd(3)} ${el.name.padEnd(14)} atomic #${el.number}  ${el.mass} g/mol`);
}

function main(argv: string[]): void {
  const cmd = argv[2];
  try {
    if (cmd === undefined || cmd === "--help" || cmd === "-h") {
      console.log(USAGE);
      return;
    }
    if (cmd === "--version" || cmd === "-v") {
      console.log(VERSION);
      return;
    }
    if (cmd === "balance") {
      cmdBalance(argv[3] ?? "");
      return;
    }
    if (cmd === "element") {
      cmdElement(argv[3] ?? "");
      return;
    }
    console.error(`chem: unknown command '${cmd}'. Run 'chem --help'.`);
    process.exitCode = 1;
  } catch (err) {
    console.error(`chem: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main(process.argv);