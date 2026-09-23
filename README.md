# ChemEngine

Autonomous, fully offline chemical simulation engine.

ChemEngine takes chemistry *inputs* — formulas, equations, species — and does the math. Eventually it will also *propose* reactions from reactants alone, judge feasibility via Gibbs free energy, and simulate reaction kinetics. Everything runs locally; all knowledge is embedded data + code, no network access.

**Implemented today:** formula parsing, equation parsing, exact equation balancing, periodic table queries, dimensional analysis (mol/L/s), a beautiful Ink-based console TUI (hotkeys, command palette, history), plus a plain REPL + one-shot CLI and a scriptable API.

## Requirements

- Node.js ≥ 20 (developed on Node 24 — TypeScript files run natively, no build step)
- npm

## Install

```sh
npm install
```

Runtime dependencies for the terminal UI: `ink` + `react` (presentation only — the chemistry engine itself stays dependency-free).

### The `chem` command

Three ways to run the CLI, no `npm run` ceremony:

| Way | How | When to use |
|---|---|---|
| Global | `npm link` | `chem` available anywhere on the machine |
| Local wrapper | `.\chem.cmd` (Windows) or `./chem` (Unix) | Only inside the repo, no global install |
| Node directly | `node src/cli/index.ts` | Scripts, CI, anything |

`npm test` and `npm run typecheck` work as usual.

## Interactive console (TUI)

Run `chem` with **no arguments** in a terminal to get the full-screen console:

```
╔══════════════════════════════════════════════════════════════════╗
║  ChemEngine v0.2.0                autonomous · offline · local   ║
╚══════════════════════════════════════════════════════════════════╝
 ╭──────────────────────────────────────────────────────────────────╮
 │ #1 $ balance CH4 + O2 -> CO2 + H2O                              │
 │ CH4 + 2O2 -> CO2 + 2H2O                                         │
 │ Stoichiometry: 1 x CH4 16.043 g/mol · 2 x O2 31.998 g/mol …     │
 ╰──────────────────────────────────────────────────────────────────╯
 chem> balance CH4 + O2 -> CO2 + H2O
 ┌──────────────────────────────────────────────────────────────────┐
 │ ↵ run · Tab complete · / palette · ↑↓ history · PgUp/PgDn results│
 │  · ^L clear · ^C exit                                            │
 └──────────────────────────────────────────────────────────────────┘
```

Built on [Ink](https://github.com/vadimdemedes/ink) (the same terminal-UI stack as OpenCode):

| Key | Action |
|---|---|
| `Enter` | run the current input |
| `Tab` / `Shift+Tab` | cycle completion (commands → element symbols) |
| `↑ / ↓` | recall previous/next command |
| `PgUp / PgDn` | scroll result history |
| `/` | open the command palette (fuzzy filter, `Enter` picks) |
| `Ctrl+L` | clear result history |
| `Ctrl+G` | show/hide the guide panel |
| `Esc` | clear input / close palette |
| `Ctrl+C` | exit (again when the input is non-empty) |

- Type commands **raw** — no quotes, no shell escaping (`+`, `->`, `<=>` are safe here).
- Results render as bordered cards — green for success, red for errors — and persist across the session (scrollable).
- **`help`, `examples`, `clear`, `exit`** are built-in; `help balance` works too.
- A spinner shows while a command computes (used by the upcoming `simulate`).
- The console adapts to your terminal: on wide screens a **guide panel** (commands, keys, engine facts) docks on the right; on short terminals the banner/info/footer chrome collapses to keep the input line and results on screen.

### Configuration & history

Preferences and command history live in `~/.chemengine/`:

- `config.json` — `{"resultLimit": 8, "bannerOn": true, "guideOn": true}`
- `history.json` — last 500 commands, recalled with `↑` across sessions

Edit `config.json` (or delete it to reset). Commands also work **non-interactively**: when stdin isn't a terminal (pipes, CI), `chem` automatically degrades to a plain REPL; with arguments it runs one command and exits.

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

(All imports use explicit `.ts` extensions, matching the `allowImportingTsExtensions` setting. The TUI components render Ink via `createElement` in plain `.ts` files — Node type-stripping does not handle `.tsx`, so JSX is deliberately avoided to keep the no-build-step promise.)

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
| M2b | Console TUI: Ink UI (banner, result cards, footer), hotkeys + completion, `/` palette, result history, config persistence, TTY auto-fallback | ✅ done |
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
  cli/        console entry (TUI/REPL/one-shot), commands,
              rendering, suggestions                         [M1-2]
  tui/        Ink TUI: app, state reducer, keymap,
              completions, palette, persist, components      [M2b]
  structure/  molecule graphs, smiles interface              [M3 - planned]
  knowledge/  species classification                         [M3 - planned]
  rules/      reaction rule set + engine                     [M4 - planned]
  thermo/     ΔG computation + feasibility ranking           [M4 - planned]
  sim/        kinetics + SimEngine                           [M5 - planned]
tests/        vitest suites
chem / chem.cmd   local launchers (no global install needed)
```