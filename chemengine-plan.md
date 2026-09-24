# ChemEngine — Implementation Plan

> Status: PLAN — approved 2026-09-23.
> Language: **TypeScript (strict, Node 24)**. Hybrid C++ compute core is a *future* exploration on a separate branch — decisions here keep interfaces clean enough to allow it.

## 1. Goal

An **autonomous, fully offline** chemical engine that:

1. **Understands species** — formulas, molecular structure (lightweight connectivity graphs), and classification (acid/base/salt/metal/oxide/hydrocarbon…).
2. **Proposes reactions** from reactants alone, using a built-in reaction rule set.
3. **Judges feasibility** via Gibbs free energy (`ΔG_rxn`) from an embedded thermochemistry table.
4. **Ranks candidates** (most spontaneous first) and **explains its reasoning**.
5. **Simulates kinetics** of accepted reactions with unit-aware rate constants.

No network, no scraping. All knowledge = curated code + embedded data files we own.

## 2. Architecture (layered, interfaces between layers)

```
data/
  elements.json        periodic table, 118 elements
  thermo.json          ΔGf° @298.15 K, ~200 curated common species
src/
  util/                rational.ts (exact arithmetic) · units.ts (mol/L/s)
  core/                elements · formula · equation · balance          (L0: math)
  structure/           Molecule graph (atoms/bonds) · fromFormula.ts
                       smiles.ts                                       (L1: interface stub)
  knowledge/           classify.ts                                      (L2: species classes)
  rules/               ReactionRule interface · built-in rules
                       ruleEngine.ts                                    (L3: candidate proposals)
  thermo/              thermo.ts (ΔG_rxn) · feasibility.ts (ranking)    (L4: feasibility)
  sim/                 kinetics.ts · engine.ts (SimEngine, RK4)         (L5: simulation)
  cli/                 console (REPL) + one-shot commands
                       predict · balance · simulate · classify · …      (L6: interface)
tests/                 vitest, one suite per layer
```

Stability rule: **layer boundaries are interfaces**, so SMILES parsing, more rules, temperature dependence, or a C++/WASM simulation core can be added without rewriting existing layers.

## 3. How autonomy works (offline pipeline)

| Step | Component | Input → Output |
|---|---|---|
| 1 | `core/formula`, `structure/fromFormula` | `"H2SO4"` → molecule graph + element counts |
| 2 | `knowledge/classify` | molecule → class + reasoning (acid, base, salt, …) |
| 3 | `rules/ruleEngine` | reactants → candidate products (all applicable rules fire) |
| 4 | `core/balance` | each candidate → balanced equation (exact rationals) |
| 5 | `thermo/feasibility` | balanced candidates → ΔG rank, spontaneity flags, explanations |
| 6 | `sim/engine` | accepted reactions + user rate constants → concentration time series |

Unknowns are surfaced, never guessed: no applicable rule → "no known reaction"; missing ΔGf° → "unknown feasibility".

## 4. Milestones (review gate after each)

### M0 — Scaffold
- npm + package.json, TypeScript (strict), vitest, tsx; git repo + GitHub remote; `.gitignore`, `README.md`; CLI skeleton (`chem --help`); `data/elements.json` wired.
- **Acceptance:** `npx tsx src/cli/index.ts --help` runs; empty test suite executes green.

### M1 — Core chemistry math
- `util/rational.ts`, `util/units.ts` (mol/L/s dimensional quantities + parse/format/validation), elements table, formula parser (`H2O`, `(NH4)2SO4`, `CuSO4·5H2O`), equation parser (`->`, `<=>`), rational balancer (rejects impossible equations with clear errors).
- **Acceptance:** `chem balance "CH4 + O2 -> CO2 + H2O"` returns balanced equation; wrong-unit rate constants rejected; test suites green.

### M2 — Console UX (interactive console + real `chem` command)
- **Real `chem` command:** `package.json` `bin` → `src/cli/index.ts` (Node 24 runs TS natively — verified: `node src/cli/index.ts balance …` works) + `npm link` for a global `chem`; plus a committed project-local `chem.cmd` (Windows) wrapper so the repo works without a global install. No more `npm run cli --`.
- **Interactive console (REPL):** `chem` with no args drops into a `chem>` prompt (readline). Type `balance CH4 + O2 -> CO2 + H2O` directly — no quotes, no wrapper noise. `element`, `exit`/`quit`, `clear` supported.
- **In-console guide:** `help` shows each command with synopsis + runnable examples; `examples` plays 2–3 demos; unknown commands get friendly hints (`Did you mean 'balance'?`), never stack traces.
- **Polish extras:** ANSI color when attached to a TTY (plain output when piped); multi-line input continuation on unbalanced parentheses; command history via readline.
- **Consistency:** one-shot CLI mode unchanged; identical output rendering from both entry points.
- **Housekeeping:** README usage section + milestone table updated (renumbered: structure→M3, prediction→M4, kinetics→M5, extensions→M6).
- **Acceptance:** `chem` → REPL works; `chem balance "…"` and `chem element O` one-shot identical to M1; `help`/`examples`/`exit` behave; `chem.cmd` verified on Windows; REPL dispatcher unit-tested; full suite green.

### M2b — Console TUI (Ink-based terminal UI)
- **Rendering:** full-screen TUI rendered with `ink` + `react` (the same stack as OpenCode) — banner header, bordered result cards (green ok / red error), footer key-hint bar. JSX is avoided (`createElement` in `.ts`) so the no-build-step promise holds — Node's type stripping does not handle `.tsx`.
- **Hotkeys & completion:** `Tab` completes command names → element symbols; `↑/↓` command history; `PgUp/PgDn` scroll result history; `Esc` clears/abandons; `Ctrl+L` clears results; `Ctrl+C` exits (double-press confirm while input is non-empty).
- **Command palette:** `/` opens a fuzzy-filtered palette (commands + meta actions); `Enter` drops the selection into the input line.
- **Result history:** session results persist as cards, scrollable with `PgUp/PgDn`, capped by config (dynamic page size from terminal height).
- **Config & history persistence:** `~/.chemengine/config.json` (`resultLimit`, `bannerOn`, `guideOn`) and `history.json` (last 500 commands). Handles corrupt/missing files gracefully.
- **Spinner:** animated indicator while a command computes (used by `simulate` in M5).
- **Adaptive fixed-pinned layout** (M2b enhancement): full-screen root heights to the terminal (`useWindowSize`); banner + engine-info strip pinned top, input + footer pinned bottom, middle region owns all scrolling. Wide terminals (≥105 cols) dock a right-hand **guide panel** (`Ctrl+G` toggles, persisted in config); short terminals collapse banner/info/footer chrome. Layout math lives in pure `layout.ts`; guide content in pure `guide.ts`.
- **Auto-fallback:** TTY → TUI; piped/CI stdin → plain REPL (unchanged); arguments → one-shot (unchanged). All three share the same `runCommand` core.
- **Dependency policy change:** `ink` + `react` become the first runtime deps (presentation only — core engine stays dependency-free).
- **Acceptance:** `chem` on a TTY shows the TUI (banner/panels/footer); hotkeys, palette, completion, history, and scroll work → now unit-tested with 105 tests; one-shot + piped REPL behave exactly as M2; pure modules (state reducer incl. `toggle-guide` + dynamic scroll page, keymap incl. `Ctrl+G`, layout math, guide content, completions, palette filtering, persistence) and headless component rendering (`renderToString`) unit-tested; full suite green.
- **Version:** bumped to 0.2.0 for M2b.

### M2b.1 — TUI hotfix sprint (v0.2.1)
User-reported bugs + new requests, verified headlessly and in a real terminal:

1. **Invisible input line** with the guide open and/or 4+ tall result cards — root cause verified with `renderToString`: flex shrink spreads across all root siblings, the tall results stack squeezes the 1-row input to 0. Fix: pin all chrome (`flexShrink: 0` + explicit heights banner 5 / info 1 / input 1 / footer 3), give the center an exact computed height (`viewportRows`) + `overflowY: hidden`. Regression test renders the full pinned frame at 24×160 with guide + 4 tall results and asserts `chem>` is on line 20, footer 22–24.
2. **Command line hidden when the terminal is resized** — same squeeze mechanism during geometry changes, plus tiny-window overflow (fixed chrome summing to more than `rows` pushes the input off-screen). Fix: pinned chrome (identical to #1) + tightened `layout.ts` guards so chrome rows can never exceed `rows` at any geometry (banner hidden below `BANNER_ROWS`, info+footer hidden below `MIN_CHROME_ROWS`, input always pinned to the bottom row when chrome collapses). Verified by a geometry-matrix render probe (5×40 … 60×200) asserting the input line is always present and on-screen.
3. **Broken/crowded center scrolling** — card-count scrolling replaced by exact row-based scrolling (`src/tui/scroll.ts`): `scrollTop: number | null`, heights via Ink's exact wrap (`wrapAnsi(text, width, { trim: false, hard: true })`), `scrollMax`/`clampScroll`/`visibleRange`/`pageStep`, PgUp/PgDn = `max(1, viewportRows-1)`, wheel step 3.
4. **No autoscroll** — pinned-to-bottom semantics: `scrollTop: null` = follow the newest output; submit and clear-results reset to null; scrolling to the bottom re-pins to null; `ResultPane` renders the newest slice when null. Tested in the reducer suite + a render assertion that the newest card is visible under autoscroll.
5. **Wheel scrolls only the center results window, click positions the input cursor** — SGR (1006) + X10 (1000) mouse via `src/tui/mouse.ts` (chunked parser, `classifyMouse`) wired through `src/tui/mousebridge.ts`; wheel events → `wheel-up/down`, left-press on the input row → `set-cursor` (`colToCursorIndex`, prompt offset 7); ignored while the palette is open; enabled only when `isRawModeSupported` (real TTY). Ink emits the whole CSI sequence as one input event, so the keymap guard drops it (`input.length > 1 && startsWith("\u001b")` after arrow checks) and mouse bytes never pollute the input.
6. **Version bump to 0.2.1** + `wrap-ansi` added explicitly to `package.json` (hoisted ink dep, ESM default import verified).

Acceptance: `npm test` + `tsc --noEmit` green (**135 tests, verified**) — real-terminal check (task 10): input visible with guide + 4+ outputs and after resizing, PgUp/PgDn + wheel scroll the center only, click-to-position cursor, autoscroll to newest, ^G toggle, typing/history/^C unaffected.

**Sprint status (2026-09-24):**
- ✅ Task 1 — plan doc updated with this sprint (incl. the two user-added items: autoscroll fix + input line hidden on window resize).
- ✅ Task 2 — `app.ts` wired (pinned chrome, exact `viewportRows` center, per-render `scrollMax`, new `ResultPane` props, MouseBridge mount, `Footer`/version untouched here) + new `src/tui/mousebridge.ts`. `src/` typechecks clean.
- ✅ Task 3 — `guide.ts` shortened to ≤26 content cols + `overflowY: hidden` + `flexShrink: 1`.
- ✅ Task 4 — `layout.ts` resize hardening: `viewportRows = max(0, …)` so chrome can never exceed `rows`; center collapses to 0 and is skipped in `app.ts` on tiny windows.
- ✅ Task 5 — new `tests/scroll.test.ts` (7) + `tests/mouse.test.ts` (12): green.
- ✅ Task 5a — `resultpane.ts` marker → `▲ N rows above — scroll down` (wrap truncate, 1 row), always slice via `visibleRange` (drop `top==0` renders-everything).
- ✅ Task 6a — `tests/tui.test.ts` updated (36 tests incl. keymap CSI guard, scrollTop reducer semantics, layout v2 math, guide width guard): green.
- ✅ Task 5b/6b probe — `probe-render.mts` verified `renderToString` respects the pinned frame: 24-row terminal → 24 lines, input at index 20, footer 21–23, center clipped to 14 rows with the guide open + 4 tall results. (Static `renderToString` renders at ~80 cols — column interleaving is a test artifact only; row positions unaffected.)
- ✅ Task 6 — `tests/tui-render.test.ts` rewritten (13 tests): new `ResultPane` props (`scrollTop`/`viewportRows`/`width`), slice test, autoscroll-shows-newest, `▲ 5 rows above — scroll down` marker, 24×160 pinned regression (via `renderFrame` helper mirroring the probe), resize geometry matrix (5×40 … 60×200 input-on-screen). `renderFrame` helper is replicated from `probe-render.mts` — the probe is deleted in Task 9, the helper stays. Full suite 135 green, `tsc --noEmit` clean.
- ✅ Task 7 — version 0.2.1 (package.json + `commands.ts` VERSION) + `wrap-ansi ^10.0.2` added to `dependencies` (matches hoisted ink copy); footer HINTS += `· wheel`; all version literals in `tui-render`/`repl`/`cli` tests bumped. Footer hint is now 82 display cols, so the footer test renders at `{ columns: 120 }` (the `render` helper now forwards `renderToString` options) and asserts the 1-content-row truncate guard; `^C exit` assertion preserved. 135 green, `tsc` clean.
- ✅ Task 8 — full gate: `npm test` 135/135 (12 files) + `npx tsc --noEmit` clean.
- ✅ Task 9 — README console section rewritten for M2b.1 (v0.2.1 sketch, pinned layout, row scroll + autoscroll, wheel/click mouse row in the key table, guide panel, resize-safe input; runtime deps now `ink`+`react`+`wrap-ansi`; M2b.1 row added to the milestone table); plan-doc status flipped (this section + §10); `probe-render.mts` deleted; committed + pushed (`nac9060`).
- ⏳ Task 10 — real-terminal checklist (human step, on a real TTY after the v0.2.1 commit): input visible with guide + 4+ tall outputs; input survives resizing; PgUp/PgDn + wheel scroll only the center; click positions the cursor; autoscroll follows newest; `^G` toggles guide; typing/history/`^C` unaffected. Then resume **M3**. (Sprint backlog, not started: see the M2b.2 note at the end of this section.)
- ⏳ **M2b.2 backlog (v0.2.2, deferred — analysed 2026-09-24, not started):** (1) fullscreen bottom-half blink while typing — root cause: `ink.js` clears the whole terminal on every fullscreen frame on win32; fix: render the frame one row under the viewport (`rows - 1`, uniform on all platforms) so Ink uses incremental diff rendering. (2) Click pastes litter (`[<0;12;20M`) — root cause: `use-input.js:97-99` strips the `\x1b` prefix before the keymap sees it, defeating the `startsWith("\u001b")` guard; fix: drop Ink-stripped SGR tails `/^\[<\d+;\d+;\d+[Mm]$/` in `keymap.ts` + feed the stripped form in tests. (3) Select & copy — drag-to-select with `?1002h` motion tracking, selection model + inverse highlight in the results pane, copy via OSC 52 (`clipboard.ts`, injectable) + `~/.chemengine/last-selection.txt` fallback + "copied N chars" toast; Esc cancels selection; Shift+drag documented fallback.

Current totals: 135 tests green (12 files, incl. `tui-render` 13, `tui` 36, `scroll` 7, `mouse` 12); `src/` typechecks clean; nothing red.

---

## Next-session handoff (for the future agent)

Environment: Windows + PowerShell (no `head`; use `Select-Object -First/-Last`). Node 24 runs TS natively (`node src/cli/index.ts …`). Commands that work: `npx vitest run <file>`, `npx tsc --noEmit`, `npm test`. Git identity `nac9060` configured; remote github.com/NotAChemist9060/ChemEngine (private). `renderToString` renders at ~80 cols — column interleaving in tests is an artifact; row positions are what matter.

**Task 7 — version 0.2.1 + `wrap-ansi` (do this next):**
1. `package.json` — `"version": "0.2.0"` → `"0.2.1"`; add `wrap-ansi` to `dependencies` (hoisted ink dep; ESM default import already proven in `src/tui/scroll.ts`: `import wrapAnsi from "wrap-ansi"`). Pick a version matching what ink hoists (check `node_modules/wrap-ansi/package.json`).
2. `src/cli/commands.ts:7` — `VERSION = "0.2.0"` → `"0.2.1"` (single source of truth; flows to banner/guide/`--version`).
3. `src/tui/footer.ts` — HINTS `+= "· wheel"` (place after `PgUp/Dn`): `↵ run · / palette · Tab · ↑↓ hist · PgUp/Dn · wheel · ^L clear · ^G guide · ^C exit`. Must stay 1 content row (wrap: truncate already set).
4. Tests asserting the literal version → `0.2.1`:
   - `tests/tui-render.test.ts`: lines 42, 58, 73, 74 (banner test + `renderFrame` helper: `Banner version`/`guideSections version` + `ChemEngine v0.2.0` expectation).
   - `tests/repl.test.ts:59` and `tests/cli.test.ts:31,55,60` — `ChemEngine v0.2.0` → v0.2.1, `--version` → `0.2.1`.
   - `tests/tui.test.ts` already uses `0.2.1` (fine, leave).
5. Verify: `npx vitest run tests/tui-render.test.ts tests/repl.test.ts tests/cli.test.ts` + `npx tsc --noEmit` + `npm test` (expect 135 green).

**Task 8 — full gate:** `npm test` + `npx tsc --noEmit` both clean (should be a formality after Task 7).

**Task 9 — docs, cleanup, commit:**
- README: add the M2b.1 console/TUI content (pinned layout, guide panel `^G`, row-based scroll PgUp/PgDn + wheel, autoscroll, mouse click-to-cursor, resize-safe input; note it belongs in the console section + maybe hit the milestone table below it). Re-read the existing README console section before editing so it flows.
- `chemengine-plan.md`: flip M2b.1 §4 status + §10 checklist to done; adjust acceptance test count (actual 135) if it still says ≈145.
- Delete `probe-render.mts` (superseded by `renderFrame` helper in `tests/tui-render.test.ts`).
- Commit + push: message like `M2b.1: pinned layout + row scroll + autoscroll + mouse + resize hardening (v0.2.1)` — check `git status` first, stage everything relevant, identity is `nac9060`.

**Task 10 — real-terminal checklist → then M3:**
Run `node src/cli/index.ts` (or `npm run cli`) on a real TTY and verify: input visible with guide + 4+ tall outputs; input stays visible after resizing down/up; PgUp/PgDn + wheel scroll only the center; click positions the input cursor; autoscroll follows newest output; `^G` toggles guide; typing/history/`^C` unaffected. Then resume **M3 — Structure & classification** per §4.

### M3 — Structure & classification
- Molecule connectivity graph; `fromFormula` construction via valence rules (chain/ring hydrocarbons, functional groups, ion pairs); `smiles.ts` interface (stub, extension point); species classifier.
- **Acceptance:** `chem classify "H2SO4"` → `acid` + reasoning; classifier tests per class.

### M4 — Prediction (rules + thermodynamics)
- `ReactionRule` interface; built-in rules: **combustion, neutralization, single displacement** (embedded reactivity series), **double displacement** (embedded solubility rules), **combination, decomposition**; `data/thermo.json` (ΔGf° ≈200 species, cited sources); ΔG ranking with explanations; explicit unknown/no-rule outcomes.
- **Acceptance:** `chem predict "CH4 O2"` → ranked candidates with ΔG + reasoning; ΔG tests match textbook values (combustion of methane ≈ −818 kJ/mol).

### M5 — Kinetics
- `SimEngine` interface; mass-action rate laws (reversible `<=>`); adaptive-step RK4; conservation invariants (atoms/mass) checked per step; CSV/JSON export.
- **Acceptance:** `chem simulate "2H2 + O2 -> 2H2O" --kf "0.1 L·mol⁻¹·s⁻¹" …` reproduces expected equilibrium/approach curves; invariants hold.

### M6 — Extensions (future, behind interfaces)
- SMILES parser/substructure matching, temperature dependence (Arrhenius), expanded rules + thermo data, particle-based engine (WASM/native hybrid branch), web UI.

## 5. Initial rule inventory (M4)

- Combustion: `hydrocarbon + O2 → CO2 + H2O`
- Neutralization: `acid + base → salt + water`
- Single displacement: `metal + salt/acid → new salt + metal/hydrogen` (reactivity series)
- Double displacement: `salt + salt → …` (solubility rules)
- Combination / decomposition of common compounds

New rules = new files implementing `ReactionRule`, no engine changes.

## 6. Data provenance

- Elements: standard periodic table data.
- Thermo: standard Gibbs formation energies @298.15 K from standard references (e.g., NIST WebBook values), **curated and embedded as JSON** — never fetched at runtime.
- SMILES data (later): optional downloaded subsets, stored in `data/`, offline.

## 6a. Development-time validation (NOT a runtime dependency)

Wolfram Language / Mathematica (or SymPy) is used **manually during development only**, as a reference oracle:

- balancer outputs vs Mathematica linear algebra
- ΔG values in `thermo.json` vs Wolfram thermochemistry data
- RK4 kinetics curves vs `NDSolve`

The deliverable stays pure TypeScript + embedded JSON, fully offline. No Wolfram license, kernel, or network requirement ships with the engine.

## 7. Honest limits (surfaced, not hidden)

- Prediction covers encoded rule classes; outside → "no applicable rule".
- ΔG at 298.15 K standard state; temperature dependence is a future extension point.
- Rate constants remain user-supplied (predicting kinetics is research-grade, out of scope).
- Lightweight structure model: no stereochemistry/isomers (noted; swappable backend later).

## 8. Testing strategy

- Rational arithmetic & balancer: known equations + impossible ones.
- Parsers: edge cases (nested parens, hydrates, missing coefficients).
- Classifier: one test per species class.
- Rules: positive + negative cases per rule.
- Thermo: ΔG against textbook values.
- Kinetics: invariants, equilibrium approach, reversible reactions.

## 9. Repository setup (pending)

1. Check `gh` CLI availability/authentication.
2. `git init` in `D:\Projects\ChemEngine`.
3. `gh repo create <name> --source=. --remote=origin --push` (visibility TBD).
4. `.gitignore` (node_modules, dist, *.log), README with overview + milestone status.

## 10. Status

- [x] Decisions: scope, language (TS), feedback cadence (per milestone), units (strict), autonomy model
- [x] Repo: created private at github.com/NotAChemist9060/ChemEngine, M0+M1 pushed
- [x] M0 — scaffold
- [x] M1 — core chemistry: rationals, units, formula/equation parsers, balancer (50 tests green)
- [x] M2 — console UX: global `chem` command + local launchers, REPL with help/examples/suggestions, ANSI TTY output (66 tests green)
- [x] M2b — console TUI: Ink banner/panels/footer, hotkeys + Tab completion, `/` palette, scrollable result history, `~/.chemengine` config persistence, TTY auto-fallback; v0.2.0 (105 tests green) — incl. adaptive fixed-pinned layout + `Ctrl+G` guide panel
- [x] M2b.1 — TUI hotfix sprint v0.2.1 (pinned layout, row-based scroll, autoscroll, SGR mouse wheel/click, resize-safe chrome) — 135 tests green, `tsc` clean, pushed; live-terminal check = Task 10 (pending at commit time)
- [ ] M2b.2 — select & copy + the two deferred fixes (v0.2.2) — backlog, see sprint status note above
- [ ] M3 — structure + classification
- [ ] M4 — prediction (rules + thermodynamics)
- [ ] M5 — kinetics + CLI polish