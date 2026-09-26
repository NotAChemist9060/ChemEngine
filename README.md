# ChemEngine

Autonomous, fully offline chemical simulation engine.

ChemEngine takes chemistry *inputs* — formulas, equations, species — and does the math. Eventually it will also *propose* reactions from reactants alone, judge feasibility via Gibbs free energy, and simulate reaction kinetics. Everything runs locally; all knowledge is embedded data + code, no network access.

**Implemented today:** formula parsing, equation parsing, exact equation balancing, periodic table queries, dimensional analysis (mol/L/s), molecular structure from a formula (curated structures, valence-driven construction, honest fallback), species classification with structural evidence, a beautiful Ink-based console TUI (hotkeys, command palette, history), plus a plain REPL + one-shot CLI and a scriptable API.

## Requirements

- Node.js ≥ 20 (developed on Node 24 — TypeScript files run natively, no build step)
- npm

## Install

```sh
npm install
```

Runtime dependencies for the terminal UI: `ink` + `react` + `wrap-ansi` (presentation only — the chemistry engine itself stays dependency-free).

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
║  ChemEngine v0.4.0                autonomous · offline · local   ║
╚══════════════════════════════════════════════════════════════════╝
 ╭──────────────────────────────────────────────────────────────────╮
 │ #1 $ balance CH4 + O2 -> CO2 + H2O                              │
 │ CH4 + 2O2 -> CO2 + 2H2O                                         │
 │ Stoichiometry: 1 x CH4 16.043 g/mol · 2 x O2 31.998 g/mol …     │
 ╰──────────────────────────────────────────────────────────────────╯
 chem> balance CH4 + O2 -> CO2 + H2O
 ┌──────────────────────────────────────────────────────────────────┐
 │ ↵ run · / palette · Tab · ↑↓ hist · PgUp/Dn · wheel · ^L clear… │
 └──────────────────────────────────────────────────────────────────┘
```

Built on [Ink](https://github.com/vadimdemedes/ink) (the same terminal-UI stack as OpenCode):

| Key / input | Action |
|---|---|
| `Enter` | run the current input |
| `Tab` / `Shift+Tab` | cycle completion (commands → element symbols) |
| `↑ / ↓` | recall previous/next command |
| `PgUp / PgDn` | scroll result history (row-precise) |
| mouse wheel | scroll only the results window |
| mouse click | place the input cursor (on the input line) |
| mouse drag (left, over results) | select a slice — release copies it |
| `/` | open the command palette (fuzzy filter, `Enter` picks) |
| `Ctrl+L` | clear result history |
| `Ctrl+G` | show/hide the guide panel (persisted in config) |
| `Esc` | clear input / close palette (clears an active selection first) |
| `Ctrl+C` | exit (again when the input is non-empty) |

- Type commands **raw** — no quotes, no shell escaping (`+`, `->`, `<=>` are safe here).
- Results render as bordered cards — green for success, red for errors — and persist across the session.
- The layout is **pinned**: the banner + engine-info strip (top) and the input + key-hint footer (bottom) are fixed-height chrome that can never be squeezed away; the middle region owns **all** scrolling. It clips its own rows and scrolls them row-by-row — `PgUp/PgDn` page by a viewport, the mouse wheel steps by 3. Scrolling to the bottom re-pins to **autoscroll**, which follows the newest output; a `▲ N rows above — scroll down` marker shows how many rows are scrolled off.
- The input line survives any window size: on short terminals the banner/info/footer chrome collapses instead of the input getting pushed off-screen.
- Mouse support (real terminals): the wheel scrolls only the center results window, and clicking the input line moves the cursor to the clicked position. **Dragging left across a result card** highlights a slice (inverse); releasing **copies it through the first method that succeeds** — on Windows a hidden `clip.exe` (`copied N chars → native clipboard`), otherwise OSC 52 (`→ terminal clipboard`), otherwise `~/.chemengine/last-selection.txt` (`→ last-selection.txt`) — and the toast always names the method that actually worked, because a terminal may accept an OSC 52 request and still ignore it. Copied text is sliced by terminal display column, so wide glyphs and styled output come out clean. **Hold Shift while dragging** to let the terminal do its native select/copy instead. Mouse bytes are dropped at the keymap, so clicks never type characters into the input.
- Rendering is **flicker-free** two ways: Ink's *incremental rendering* is on, so typing rewrites only the changed input row (~105 B/keystroke) instead of erasing and redrawing the whole frame (~3.7 KB/keystroke on a wide terminal with the guide open); and the frame is sized one row under the terminal height so Ink never classifies it as *fullscreen*, which on Windows would force-clear the whole terminal on every render.
- On wide terminals (≥105 cols) a **guide panel** (commands, keys, engine facts) docks on the right; `Ctrl+G` toggles it.
- **`help`, `examples`, `clear`, `exit`** are built-in; `help balance` works too.
- A spinner shows while a command computes (used by the upcoming `simulate`).
- The TUI runs in the terminal's **alternate screen buffer** (like `vim`/`htop`/`less`): no scrollback noise while it's running, and your previous shell content is restored when you exit.

### Configuration & history

Preferences and command history live in `~/.chemengine/`:

- `config.json` — `{"resultLimit": 8, "bannerOn": true, "guideOn": true}`
- `history.json` — last 500 commands, recalled with `↑` across sessions

Edit `config.json` (or delete it to reset). Commands also work **non-interactively**: when stdin isn't a terminal (pipes, CI), `chem` automatically degrades to a plain REPL; with arguments it runs one command and exits.

## One-shot usage

```sh
chem balance "CH4 + O2 -> CO2 + H2O"    # balanced equation + stoichiometry
chem element O                          # periodic table row
chem classify H2SO4                     # species class + the evidence for it
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

### `classify`

Names what a species *is*, and shows the structural evidence it read off the molecule rather than a bare label:

```sh
chem classify H2SO4
#   H2SO4 — sulfuric acid                     98.072 g/mol
#
#   acid
#     2 hydroxyls on oxygen bonded to S: an oxoacid, ionisable in water
#
#  Structure:  template · high confidence · 5 atoms in 1 particle
#     curated structure: sulfuric acid

chem classify NaOH
#   NaOH — sodium hydroxide                   39.997 g/mol
#   …
#   base
#     1 free OH⁻ anion: it gives hydroxide in water
#   …
#   also hydroxide

chem classify C2H6O
#   …
#   Limits:
#     C2H6O fits ethanol and dimethyl ether — the formula alone cannot choose
```

Classes come in specificity order, so the first one is the most telling: `acid`, `base`, `salt`, `metal`, `oxide`, `hydroxide`, `water`, `peroxide`, `element`, `hydrocarbon`, `alcohol`, `aldehyde`, `ketone`, `carboxylic-acid`, `ester`, `ether`, `amine`, `aromatic`, `hydrate` — or `unknown`, which is reported as an honest answer rather than a guess.

### `predict`

Runs the six reaction rules (combustion, neutralization, single displacement, double displacement, combination, decomposition) against the species you name, balances what they propose, and ranks the results most-favourable-first (the most negative ΔG° on top). Each result is a card: the verdict, the balanced equation spelled as you wrote it, the ΔG° that backs the verdict, and the rule's one-line why.

```sh
chem predict "Mg O2"
# Predicting Mg O2.
#
# 1. combination — spontaneous
#    2Mg(s) + O2(g) -> 2MgO(s)
#    spontaneous (ΔG° = -1138.60 kJ/mol at 298.15 K) — this reaction runs as written
#    magnesium and oxygen combine into a single substance — MgO (burns with a brilliant white flame)

chem predict "CaCO3"
# Predicting CaCO3.
#
# 1. decomposition — nonspontaneous
#    CaCO3(s) -> CaO(s) + CO2(g)
#    nonspontaneous (ΔG° = 131.01 kJ/mol at 298.15 K) — it needs energy input to run as written
#    CaCO3 breaks apart into CaO and CO2 (strong heating, the way a kiln does it)
```

When nothing can happen, `predict` says so and explains why — never an empty list that reads as a confident no:

```sh
chem predict "N2 O2"
# Predicting N2 O2.
#
# No reaction expected.
#   • N2 O2 — nitrogen and oxygen do not combine in this table — forming NO is endothermic
#     and takes lightning-scale energy, so the entry is deliberately omitted
```

A candidate the thermo table cannot price keeps its `unknown` verdict on the card and names the missing ΔGf° — it is never guessed:

```sh
chem predict "H2 Cl2"
# 1. combination — unknown
#    H2(g) + Cl2(g) -> 2HCl(g)
#    cannot be judged — no ΔGf° for HCl(g) — the table has aq, so the ΔG total is unknown
```

ΔGf° values come from standard references, per phase (`H2O(l)` ≠ `H2O(g)`, which is why methane combustion reads −817.9 with liquid water and −800.8 with vapour). All thermodynamics runs fully offline.

### `feasibility`

Prices an equation *you* write as ΔG° and judges it: `spontaneous` (ΔG° ≤ −20 kJ/mol), `nonspontaneous` (ΔG° ≥ +20, needs energy input), `marginal` inside the ±20 band (direction can flip with conditions), or `unknown` when the table cannot price it. A species with several phases in the table (H₂O: l/g/aq) asks you to say which one; a species with exactly one phase resolves to it (so `HCl` prices as aqueous hydrochloric acid).

```sh
chem feasibility "CH4 + O2 -> CO2 + 2H2O(l)"
# Feasibility: CH4 + 2O2 -> CO2 + 2H2O(l)
#
# spontaneous (ΔG° = -817.90 kJ/mol at 298.15 K) — this reaction runs as written

chem feasibility "CaCO3 -> CaO + CO2"
# Feasibility: CaCO3 -> CaO + CO2
#
# nonspontaneous (ΔG° = 131.01 kJ/mol at 298.15 K) — it needs energy input to run as written

chem feasibility "CH4 + O2 -> CO2 + 2H2O"
# Feasibility: CH4 + 2O2 -> CO2 + 2H2O
#
# cannot be judged — H2O has more than one phase (l, g, aq) — say which one, so the ΔG total is unknown
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

## Structure and classification

A formula says which atoms are present and how many; it does not say how they are joined. `chem classify` therefore works in three tiers, and always tells you which one it used:

| Tier | Source | Example | Confidence |
|---|---|---|---|
| A | a curated structure, hand-written in a small structural DSL | `H2SO4`, `C6H6`, `BaCl2` | high |
| B | built from valences: chains, rings, oxo cores, ion pairs | `C7H16`, `Cu(NO3)2`, `Fe(OH)3` | medium / low |
| C | the empirical formula and nothing more | `XeF2` | low |

```ts
import { buildStructure } from "./src/structure/fromFormula.ts";
import { classify } from "./src/knowledge/classify.ts";

const build = buildStructure("CuSO4·5H2O");
build.source;      // "template"
build.confidence;  // "high"
build.notes;       // ["hydrate: 2 formula part(s), 5 water molecule(s) among them", "curated structure: copper(II) sulfate", …]

classify("NH4OH").classes;     // ["base", "hydroxide"]
classify("XeF2").caveats;       // ["no connectivity could be built, so only the formula itself was classified"]
```

- `buildStructure` **never throws** for a formula the parser accepts. When no structure can be built it returns `molecule: null`, `source: "empirical"`, and a note saying why — the limits are surfaced, never guessed.
- `classify` reads groups of atoms in the graph (`–COOH`, `C=O` with an `–O–C`, a six-membered ring with three double bonds), so its evidence is structural and its `reasoning[i]` line explains `classes[i]`.
- Curated structures are keyed by formula, and a formula can fit more than one of them. That is not hidden: `C2H6O` is reported as ambiguous in `caveats`, because a formula genuinely cannot choose between ethanol and dimethyl ether.
- `structure/smiles.ts` is the seam for connectivity you type rather than count. M3 ships the `SmilesParser` interface and a one-slot registry (`setSmilesParser`) and **no parser**, so `readSmiles` says so out loud rather than guessing. A parser returns the same `Molecule` graph the formula path builds, hydrogens implicit on the atoms, and `formulaFromSmiles` hands the result straight to the classifier.

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
| M2b.1 | TUI hardening (v0.2.1): pinned layout, row-precise scroll + autoscroll, mouse wheel/click, resize-safe input, guide panel | ✅ done |
| M2b.2 | TUI polish (v0.2.2): one-row-under-viewport frame (dodges the win32 fullscreen clear path), keymap guard against mouse-click litter | ✅ done |
| M2b.3 | Anti-blink (v0.2.3): enable Ink incremental rendering — per-keystroke writes drop to just the input row (no full-frame erase+redraw) | ✅ done |
| M2b.4 | Select & copy (v0.2.4): drag over results → inverse highlight → release copies via OSC 52 (file fallback), Esc clears | ✅ done |
| M2b.5 | Copy/scroll/geometry fixes (v0.2.5): native Windows `clip.exe` clipboard chain, display-cell line model (wide glyphs + ANSI keep card borders flush), true-bottom scroll + resize re-clamp | ✅ done |
| M3 | Structure (v0.3.0): molecule graph model, curated structure templates, three-tier formula → structure builder, species classifier with structural evidence, `chem classify`, SMILES extension point | ✅ done |
| M4 | Prediction (v0.4.0): all six reaction rules (combustion, neutralization, single/double displacement, curated combination + decomposition tables), rule engine with visible skips, ΔG ranking with spontaneous/marginal/nonspontaneous/unknown verdicts, `chem predict` + `chem feasibility` | ✅ done |
| M5 | Kinetics: SimEngine, adaptive RK4, CSV/JSON export | planned |
| M6 | Extensions: SMILES parser, Arrhenius/temperature, particle engine, web UI | future |

See the plan document (architecture, milestone details, decisions) for the full roadmap.

## Layout

```
data/         embedded JSON data (periodic table; thermo table)
src/
  util/       rational + units                               [M1]
  core/       elements, formula, equation, balance           [M1]
  cli/        console entry (TUI/REPL/one-shot), commands,
              rendering, suggestions                         [M1-2]
  tui/        Ink TUI: app, state reducer, keymap,
              completions, palette, persist, components      [M2b]
  structure/  molecule graphs, curated templates,
              formula → structure builder, SMILES seam       [M3]
  knowledge/  species classification                         [M3]
  rules/      six reaction rules + rule engine               [M4]
  thermo/     ΔG computation + feasibility ranking           [M4]
  sim/        kinetics + SimEngine                           [M5 - planned]
tests/        vitest suites
chem / chem.cmd   local launchers (no global install needed)
```