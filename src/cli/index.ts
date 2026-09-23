#!/usr/bin/env node

const VERSION = "0.1.0";

const USAGE = `ChemEngine v${VERSION}
Autonomous offline chemical simulation engine.

Usage:
  chem <command> [options]

Options:
  --help, -h     Show this help
  --version, -v  Print version

Commands (scaffolded, implemented in later milestones):
  balance    Balance a chemical equation                          [M1]
  element    Query periodic table data                            [M1]
  classify   Classify a species (acid/base/salt/metal/...)        [M2]
  predict    Predict reactions from reactants                     [M3]
  simulate   Simulate reaction kinetics                           [M4]
`;

function main(argv: string[]): void {
  const cmd = argv[2];
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  console.error(`chem: unknown command '${cmd}'. Run 'chem --help'.`);
  process.exitCode = 1;
}

main(process.argv);