# ChemEngine

Autonomous, fully offline chemical simulation engine.

ChemEngine takes chemistry *inputs* — formulas, equations, species — and does the math. Eventually it will also *propose* reactions from reactants alone, judge feasibility via Gibbs free energy, and simulate reaction kinetics. Everything runs locally; all knowledge is embedded data + code, no network access.

**Implemented today:** formula parsing, equation parsing, exact equation balancing, periodic table queries, and dimensional analysis (mol/L/s) — behind a small CLI and a scriptable API.

## Requirements

- Node.js ≥ 20 (developed on Node 24)
- npm

## Quickstart

```sh
npm install
npm run cli -- --help      # run the CLI
npm test                   # run the test suite (vitest)
npm run typecheck          # strict TypeScript check
```

## CLI usage

Run the CLI with `npm run cli -- <command> ...`, or `npx tsx src/cli/index.ts <command> ...`.

### `chem --help` / `chem --version`

Show usage or the version number.

### `chem balance "<equation>"`

Balance a chemical equation. The engine ignores any written coefficients and
recomputes the true smallest-integer balance, so you can write unbalanced
equations freely.

```sh
npm run cli -- balance "CH4 + O2 -> CO2 + H2O"
```

```
CH4 + 2O2 -> CO2 + 2H2O

Stoichiometry:
  1 x CH4          16.043 g/mol
  2 x O2           31.998 g/mol
  1 x CO2          44.009 g/mol
  2 x H2O          18.015 g/mol

Conserved elements: C, H, O
```

More examples:

```sh
npm run cli -- balance "KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O"
# 2KMnO4 + 16HCl -> 2KCl + 2MnCl2 + 5Cl2 + 8H2O

npm run cli -- balance "C + O2 -> CO + CO2"
# 4C + 3O2 -> 2CO + 2CO2

npm run cli -- balance "N2 + H2 <=> NH3"
# N2 + 3H2 <=> 2NH3   (reversible)
```

Impossible equations fail cleanly:

```sh
npm run cli -- balance "CH4 -> C2H6"
# chem: equation cannot be balanced: atom counts are inconsistent (CH4 -> C2H6)
```

### `chem element <symbol>`

Query the periodic table (case-insensitive):

```sh
npm run cli -- element O
#   O   Oxygen         atomic #8  15.999 g/mol
```

## Equation syntax

The parser is intentionally tolerant:

| Syntax | Meaning |
|---|---|
| `->`, `→`, `⟶`, `=>`, `=` | forward reaction |
| `<=>`, `⇌` | reversible reaction |
| `2H2 + O2` | coefficients (optional; decimal + fractional allowed, e.g. `0.5H2`, `1/2H2`) |
| `(NH4)2SO4`, `Al2(SO4)3` | groups and nested groups in formulas |
| `CuSO4·5H2O` | hydrates (· separator) |
| `NaCl(s)`, `AgNO3(aq)` | physical states `(s) (l) (g) (aq)` |

## Using as a library

All modules are plain TypeScript (ESM) under `src/` — no build step needed to
import them through `tsx`:

```ts
// example.ts
import { parseEquation } from "./src/core/equation.ts";
import { balanceEquation, formatBalancedEquation } from "./src/core/balance.ts";
import { parseFormula } from "./src/core/formula.ts";
import { parseQuantity, unitForOrder } from "./src/util/units.ts";

const eq = parseEquation("H2 + O2 -> H2O");
const balanced = balanceEquation(eq);
console.log(formatBalancedEquation(balanced)); // 2H2 + O2 -> 2H2O

console.log(parseFormula("H2SO4").molarMass); // 98.072

// Units: a rate constant for a second-order step must be L·mol⁻¹·s⁻¹
const k = parseQuantity("0.1 L·mol⁻¹·s⁻¹");
console.log(k.value, k.dim); // 0.1 { mol: -1, L: 1, s: -1 }
console.log(unitForOrder(2)); // { mol: -1, L: 1, s: -1 }
```

```sh
npx tsx example.ts
```

(All imports use explicit `.ts` extensions, matching the `allowImportingTsExtensions` setting.)

## Units (mol/L/s)

Concentrations are `mol/L`; time is `s`. The `util/units` module parses and
renders dimensions with superscript notation:

- `M` ⇔ `mol/L`
- `s⁻¹` — first-order rate constants
- `L·mol⁻¹·s⁻¹` — second-order rate constants
- `L²·mol⁻²·s⁻¹` — third-order

`unitForOrder(n)` returns the dimension a rate constant must have for a step of
order `n` — kinetics (M4) will validate your `k` values against it.

## Development

```sh
npm test            # vitest, all suites
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit (strict)
npm run cli -- ...  # run the CLI
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

See the plan document (architecture, milestone details, decisions) for the full roadmap.

## Layout

```
data/         embedded JSON data (periodic table; thermo table in M3)
src/
  util/       rational + units                     [M1]
  core/       elements, formula, equation, balance [M1]
  structure/  molecule graphs, smiles interface    [M2 - planned]
  knowledge/  species classification               [M2 - planned]
  rules/      reaction rule set + engine           [M3 - planned]
  thermo/     ΔG computation + feasibility ranking [M3 - planned]
  sim/        kinetics + SimEngine                 [M4 - planned]
  cli/        command-line interface               [M0-1]
tests/        vitest suites
```