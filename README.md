# ChemEngine

Autonomous, fully offline chemical simulation engine.

ChemEngine takes chemistry *inputs* — formulas, equations, species — and does the math. Eventually it will also *propose* reactions from reactants alone, judge feasibility via Gibbs free energy, and simulate reaction kinetics. Everything runs locally; all knowledge is embedded data + code, no network access.

**Implemented today:** formula parsing, equation parsing, exact equation balancing, periodic table queries, dimensional analysis (mol/L/s), and a friendly interactive console — behind a small CLI and a scriptable API.

## Requirements

- Node.js ≥ 20 (developed on Node 24 — TypeScript files run natively, no build step)
- npm

## Install

```sh
npm install
```

### The `chem` command

Three ways to run the CLI, no `npm run` ceremony:

| Way | How | When to use |
|---|---|---|
| Global | `npm link` | `chem` available anywhere on the machine |
| Local wrapper | `.\chem.cmd` (Windows) or `./chem` (Unix) | Only inside the repo, no global install |
| Node directly | `node src/cli/index.ts` | Scripts, CI, anything |

`npm test` and `npm run typecheck` work as usual.

## Interactive console

Run `chem` with **no arguments** to drop into the REPL:

```
$ chem
chem> balance CH4 + O2 -> CO2 + H2O
CH4 + 2O2 -> CO2 + 2H2O

Stoichiometry:
  1 x CH4         16.043 g/mol
  2 x O2          31.998 g/mol
  1 x CO2         44.009 g/mol
  2 x H2O         18.015 g/mol

Conserved elements: C, H, O
chem>
```

- Type commands **raw** — no quotes, no shell escaping (`+`, `->`, `<=>` are safe here).
- **`help`** — in-console guide for every command; `help balance` for one command.
- **`examples`** — runs several demos live so you can see expected output.
- **`clear`** clears the screen; **`exit`** / **`quit`** (or Ctrl+D) leaves.
- **Multi-line input** — an unclosed parenthesis continues on the next line.
- **History** — up/down arrows recall previous lines (TTY only).
- **Colors** — ANSI styling when attached to a terminal, plain text when piped (or with `NO_COLOR` set).

## One-shot usage

```sh
chem balance "CH4 + O2 -> CO2 + H2O"    # balanced equation + stoichiometry
chem element O                          # periodic table row
chem --help | -h                        # help
chem --version | -v                     # version
```

> Shell note: in `cmd.exe`/PowerShell, quote the equation — bare `->` is a redirect and `+` can be misparsed. Inside the console, quoting is never needed.

### `balance`

Balances any chemical equation with exact rational arithmetic; written coefficients are hints — the engine recomputes the true smallest-integer balance.

```sh
chem balance "KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O"
# 2KMnO4 + 16HCl -> 2KCl + 2MnCl2 + 5Cl2 + 8H2O

chem balance "N2 + H2 <=> NH3"
# N2 + 3H2 <=> 2NH3   (reversible)
```

Impossible equations fail cleanly:

```sh
chem balance "CH4 -> C2H6"
# chem: equation cannot be balanced: atom counts are inconsistent (CH4 -> C2H6)
```

### `element`

```sh
chem element O
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

All modules are plain TypeScript (ESM) under `src/` — import them directly through `node` (Node 24) or `tsx`:

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
node example.ts      # Node 24+ runs TS natively
# or: npx tsx example.ts
```

(All imports use explicit `.ts` extensions, matching the `allowImportingTsExtensions` setting.)

## Units (mol/L/s)

Concentrations are `mol/L`; time is `s`. The `util/units` module parses and renders dimensions with superscript notation:

- `M` ⇔ `mol/L`
- `s⁻¹` — first-order rate constants
- `L·mol⁻¹·s⁻¹` — second-order rate constants
- `L²·mol⁻²·s⁻¹` — third-order

`unitForOrder(n)` returns the dimension a rate constant must have for a step of order `n` — kinetics (M5) will validate your `k` values against it.

## Development

```sh
npm test            # vitest, all suites
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit (strict)
npm run cli -- ...  # run the CLI (same thing as `chem`)
```

## Milestone status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Scaffold: TS strict + vitest, CLI skeleton, periodic table data wired | ✅ done |
| M1 | Core math: rationals, units (mol/L/s), formula/equation parsers, equation balancer | ✅ done |
| M2 | Console UX: real `chem` command, interactive REPL, in-console guide | ✅ done |
| M3 | Structure: molecule graphs, species classifier, SMILES extension point | planned |
| M4 | Prediction: reaction rules + ΔG ranking with reasoning | planned |
| M5 | Kinetics: SimEngine, adaptive RK4, CSV/JSON export | planned |
| M6 | Extensions: SMILES parser, Arrhenius/temperature, particle engine, web UI | future |

See the plan document (architecture, milestone details, decisions) for the full roadmap.

## Layout

```
data/         embedded JSON data (periodic table; thermo table in M4)
src/
  util/       rational + units                               [M1]
  core/       elements, formula, equation, balance           [M1]
  cli/        console (REPL) + one-shot entry, commands,
              rendering, suggestions                         [M1-2]
  structure/  molecule graphs, smiles interface              [M3 - planned]
  knowledge/  species classification                         [M3 - planned]
  rules/      reaction rule set + engine                     [M4 - planned]
  thermo/     ΔG computation + feasibility ranking           [M4 - planned]
  sim/        kinetics + SimEngine                           [M5 - planned]
tests/        vitest suites
chem / chem.cmd   local launchers (no global install needed)
```