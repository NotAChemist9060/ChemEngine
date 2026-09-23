# ChemEngine

Autonomous, fully offline chemical simulation engine.

Given reactants, the engine classifies species (acid/base/salt/metal/…), proposes reactions from a built-in rule set, judges feasibility via Gibbs free energy (ΔG from an embedded thermochemistry table), ranks candidates with reasoning, and simulates kinetics with unit-aware rate constants.

## Quickstart

```sh
npm install
npm run cli -- --help   # run the CLI
npm test                # run the test suite
npm run typecheck       # strict TypeScript check
```

## Milestone status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Scaffold: TS strict + vitest + tsx, CLI skeleton, periodic table data wired | ✅ done |
| M1 | Core math: rationals, units (mol/L/s), formula/equation parsers, equation balancer | ✅ done |
| M2 | Structure: molecule graphs, species classifier, SMILES extension point | planned |
| M3 | Prediction: reaction rules + ΔG ranking with reasoning | planned |
| M4 | Kinetics: SimEngine, adaptive RK4, CSV/JSON export | planned |
| M5 | Extensions: SMILES parser, Arrhenius/temperature, particle engine, web UI | future |

See `C:\Users\G4SL33K\.opencode\plan\chemengine-plan.md` for the full plan.

## Layout

```
data/         embedded JSON data (periodic table, thermo table)
src/
  util/       rational + units
  core/       elements, formula, equation, balance
  structure/  molecule graphs, smiles interface
  knowledge/  species classification
  rules/      reaction rule set + engine
  thermo/     ΔG computation + feasibility ranking
  sim/        kinetics + SimEngine
  cli/        command-line interface
tests/        vitest suites
```