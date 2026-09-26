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
  structure/           valence · molecule (atoms/bonds) · dsl · templates
                       fromFormula · smiles                                (L1: structure)
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
- ⏳ Task 10 — real-terminal checklist (human step; now covers M2b.1–M2b.3): input visible with guide + 4+ tall outputs; input survives resizing; PgUp/PgDn + wheel scroll only the center; click positions the cursor **and never adds characters**; **no bottom-half blink while typing at fullscreen** (M2b.3: specifically with the guide open, long continuous typing); autoscroll follows newest; `^G` toggles guide; typing/history/`^C` unaffected. Then resume **M3**.

### M2b.2 — TUI polish sprint (v0.2.2)

User-reported bugs fixed (root causes verified against Ink's source, 2026-09-24):

1. **Bottom-half blink while typing (fullscreen)** — root cause: `ink.js:88-102` — on win32 any frame that fills the viewport makes Ink write `clearTerminal` + the whole frame on **every** render (`ink.js:768`), bypassing the incremental diff (`log-update.js:174` exists to prevent exactly this flicker). Fix: render the frame one row under the terminal on **all** platforms — `VIEW_PAD`/`viewHeight()` in `layout.ts`, `app.ts` drives layout + root height from them; Ink then uses its incremental renderer. Cost: one unused bottom row (invisible on the alternate screen buffer).
2. **Click pastes litter** (`[<0;12;20M` landing in the input) — root cause: `use-input.js:97-99` strips the leading `\x1b` from unknown sequences before the `useInput` callback, so the keymap's `startsWith("\u001b")` guard never fires and the tail falls through to `insert` (`state.ts:107`). The M2b.1 guard test fed the *raw* `\u001b[<…` form, so it passed headlessly. Fix: `keymap.ts` gains `SGR_TAIL_RE = /^\[<\d+;\d+;\d+[Mm]$/`; Ink-stripped tails are dropped before the insert fallthrough. Covers press/release/wheel and protects the palette query too.

Acceptance: `npm test` + `tsc --noEmit` green (**136 tests**); live check — no blink while typing at fullscreen; clicking only moves the cursor, never types.

**Sprint status (2026-09-24):**
- ✅ Task A — version 0.2.2: `package.json` (+ regenerated `package-lock.json`: root version + `wrap-ansi`), `commands.ts` VERSION, all literals in `tui-render`/`repl`/`cli`/`tui` tests + README sketch.
- ✅ Task B — flicker fix: `VIEW_PAD`/`viewHeight` in `layout.ts`, `app.ts` layout + root height from `viewHeight(rows)`; `renderFrame` helper, pinned 24×160 regression and geometry matrix all derive from the same exports (deterministic on any OS). `tui-render` 13 green.
- ✅ Task C — litter fix: `SGR_TAIL_RE` guard + new keymap test feeding the Ink-stripped tails (dropped; printable input still inserts). `tui.test.ts` 36 → 37.
- ✅ Task D — gate `npm test` 136/136 + `tsc --noEmit` clean; README (v0.2.2, flicker + litter bullets, M2b.2 milestone row) + this plan doc updated; committed + pushed (`nac9060`).
- ✅ Select & copy (drag-select + OSC 52) — shipped in M2b.4 (v0.2.4).

Current totals: 136 tests green (12 files, incl. `tui-render` 13, `tui` 37, `scroll` 7, `mouse` 12); `src/` typechecks clean; nothing red.

### M2b.3 — anti-blink sprint (v0.2.3)

The v0.2.2 "flicker-free" fix was incomplete: it only kept the frame one row under the viewport so Ink never took the win32 fullscreen force-clear path (`ink.js:88-102`, `ink.js:768`). Ink's **incremental renderer was never active** — `render.js` defaults `incrementalRendering: false`, so Ink's standard renderer (`log-update.js` `createStandard`) **erases and rewrites the entire frame on every keystroke**. Live diagnosis (user, 2026-09-24): the blink persisted **with the guide open** and vanished with it hidden — a wide frame makes the full erase+redraw far more visible.

Root cause verified empirically (temp `probe-writes.mts` on fake TTY streams, deleted before commit): per-keystroke stdout bytes at 24×160 —

| guide | incrementalRendering | bytes/keystroke | full-line erases (`\x1b[2K`) |
|---|---|---|---|
| on | off (Ink default) | ~3665 | 24 |
| off | off (Ink default) | ~1646 | 24 |
| on | **on** | ~105 | 0 |
| off | **on** | ~105 | 0 |

Fix: `src/tui/index.ts` — `TUI_RENDER_OPTIONS` += `incrementalRendering: true` (explicit, since Ink's default is false) with a comment tying it to `log-update.js` `createStandard` vs `createIncremental`. The one-row-under viewport stays: incremental → only changed lines written; rows−1 → never fullscreen → no win32 `clearTerminal` per frame. Both layers are required.

Regression: `tests/ink-writes.test.ts` mounts the real `App` on fake TTY streams (`FakeTtyStdin` swallows `data` registrations so Ink's `readable`-based input path works; `ref`/`unref`/`setRawMode` stubs; `os.homedir` redirected to a throwaway dir) and asserts per-keystroke writes stay < 400 B with no full-frame erase. (Harness lessons: base `Readable` has no `ref`/`unref`, and a missing stub silently kills Ink's input effects at mount.)

Acceptance: `npm test` + `tsc --noEmit` green (**138 tests**); Task 10 live check — continuous typing with the guide open must be rock-solid.

### M2b.4 — select & copy sprint (v0.2.4)

**Shipped (2026-09-25):** drag-select over result cards → release copies the slice via OSC 52 (fallback `~/.chemengine/last-selection.txt` on non-TTY). Highlights render **per-cell** (selected = flat inverse, no color/dim; box border glyphs keep the card color; headers stay dim) for byte-parity with the card-box path, so switching paths mid-drag only rewrites the highlighted lines. Blockers solved along the way: chalk strips styles at import on a non-TTY → `FORCE_COLOR=1` + dynamic imports in the E2E harness; Ink's `createIncremental` diffs **whole lines** (`log-update.js:172-189`), so a 2-row highlight costs ~563 B/event — the drag test's bounds reflect that (motion <1200, release <1500) while keystrokes keep the tight <400 B guard. Esc order: palette → selection → clear-input; typing/scroll/^L/resize clear the highlight; history ↑/↓ deliberately keep it. **198 tests green (17 files), `tsc` clean; committed + pushed (`nac9060`).** Live check (Task 10) done: drag-select, guide on/off, input-row caret, palette inertness, Esc order, resize, and no blink regression all good — but it surfaced three real bugs (copy didn't copy, frame glyphs misplaced, autoscroll couldn't reach the bottom) plus the drag-while-scrolled jump. Those became M2b.5.

### M2b.5 — copy / geometry / display-cell fixes (v0.2.5)

**Origin:** the Task 10 live check of M2b.4, plus the user's `BUG REPORT 4-42-25-9-2026.txt` (copy not copying; "walls thrown to the left of frames position"; autoscroll can't reach the newest message). All three were real, all three are fixed, verified live.

**1. Copy (`clipboard.ts`, `app.ts`) — OSC 52 is a *request*, not a command.** The terminal accepted the escape and silently ignored it, so v0.2.4 reported success and the Windows clipboard stayed empty. `writeClipboard` is now **async** and walks a fallback chain: win32 → hidden `clip.exe` (`windowsHide`, stdin pipe, resolves native only on a **clean** `close`; spawn throw / `error` / nonzero exit all fall through) → TTY OSC 52 → `~/.chemengine/last-selection.txt` → `"none"`. `ClipboardResult` gained `"native"`; the toast now names the method that actually succeeded (`→ native clipboard` / `→ terminal clipboard` / `→ last-selection.txt`) so a no-op can never masquerade as a copy. `App` gained an injectable `clipboardWriter` prop (the mouse callback is `useCallback([])`, so the ref pattern is required).

**2. Frame glyphs (`display.ts`, new — 344 lines) — three width bugs, not style bugs.** Card rows were padded with `padEnd`/`" ".repeat` on **JS string length**, so wide graphemes (CJK/emoji) overflowed the row and ANSI escapes (0 display columns, many JS chars) pulled it short — the right `│` drifted left. `renderGrid` also keyed style runs and border glyphs off JS indexes. Now every line is normalized into `DisplayCell { value, width, column, style }` (grapheme clusters via `Intl.Segmenter`, width via `string-width`, SGR via `ansi-regex`), padded to an exact display width with unstyled filler; the renderer re-applies each cell's own SGR state and `select.ts` slices with `sliceDisplayLine` (a wide grapheme is indivisible). Escapes never enter the line model, so "copy what you see" can't emit control bytes. New runtime deps: `ansi-regex`, `string-width`.

**3. Autoscroll (`scroll.ts`, `state.ts`, `app.ts`) — the maximum never matched the render.** `buildScreenLines` reserved **1** row for the marker when computing `max` but rendered **2** (marker + spacer), so the offset ceiling was one row short of the true bottom; `scrollTop === null` re-anchored to the *first visible card* instead of the bottom, hiding a card's last rows with no way down; and nothing re-clamped a stale offset when a resize changed the wrap widths. Now `scrollGeometry(heights, viewportRows, scrollTop)` is the single source — `MARKER_ROWS = 2` reserved whenever the stack overflows (`max = totalRows − (rows − reserved)`, `null → max`, `range` from the same numbers) — plus `normalizeScrollTop()` (one representation of the bottom pin) and a `clamp-scroll` action dispatched whenever `scrollMaxRows` changes. Render-path unification (one grid, no card-box branch) landed in `6beb8f6`; M2b.5 removed the M2b.4 drag-while-scrolled jump as a side effect, now E2E-covered (bottom-pinned + PgUp drags, wheel, PgDn, resize 40 rows).

**Gate:** 18 files / **220 tests** green, `tsc --noEmit` clean. New suites: `tests/display.test.ts` (5) and the clipboard/scroll/screen-line/reducer/E2E additions. Version 0.2.5.

---

## Next-session handoff (for the future agent)

Environment: Windows + PowerShell (no `head`; use `Select-Object -First/-Last`). Node 24 runs TS natively (`node src/cli/index.ts …`). Commands that work: `npx vitest run <file>`, `npx tsc --noEmit`, `npm test`. Git identity `nac9060` configured; remote github.com/NotAChemist9060/ChemEngine (private). `renderToString` renders at ~80 cols — column interleaving in tests is an artifact; row positions are what matter.

> Handoff below is current as of the M4 kickoff. Everything before it was M2b.1-era planning and is gone; what remains is the state of the tree and how to work the next milestone.

**Where we are:** M3 shipped and pushed — `5ab1ee6`, v0.3.0, **396 tests / 26 files green**, `tsc --noEmit` clean, in sync with `origin/main`. **M4 has started with T1 only: the `### M4` section in §4 is written and the §10 row says in progress.** None of the code is in the tree yet — no `data/thermo.json`, no `src/rules/`, no `src/thermo/`.

**Starting M4** — the §4 M4 section is the single source of truth: it carries the six locked decisions, the file table, the contracts and the T2–T16 task table. Work it **one task at a time, gate after each** (`npx vitest run <file>` + `npx tsc --noEmit`), the way M3 was run. Do not re-derive what the section already fixes — the notable ones are that **phases are first-class** (per-phase ΔGf°, states on every proposed species, because the milestone's acceptance number is the liquid-water figure), that **combination/decomposition are curated tables** rather than generated chemistry, and that **no-reaction and unknown-ΔG are both reported out loud** instead of collapsing to an empty list.

The short version of the order: **data → math → contracts → reference tables → six rules, one per task → engine → ranking → CLI → version/docs → gate + push.** `data/thermo.json` is the only new *data* dependency, so it goes first and is grown rule family by rule family, with a cross-check in T12 that every species any rule can propose has an entry.

M3 hands M4 two things worth using: `knowledge/classify.ts` already knows acid from base from salt, so neutralization and double-displacement rules can key off the classifier instead of string matching; and `structure/fromFormula.ts` gives a real graph per species, so a rule can ask about ions and their charges rather than re-parsing the formula.

**Standing invariants** (unchanged, still load-bearing): pure functions everywhere in `src/core`, `src/structure`, `src/knowledge`, `src/rules`, `src/thermo`; no new runtime deps; `UserError` (never a stack trace) for bad user input; one test suite per new module, written before the next module starts; no build step (Node runs the TS directly); limits surfaced in output, never guessed (§7).

### M3 — Structure & classification (v0.3.0)

**Decisions (2026-09-26, user-approved):**
1. **Curated templates + heuristic fallback** for connectivity — Tier A exact structures for common species, Tier B valence-driven construction (chains/rings/ion pairs), Tier C empirical fallback. No pure-heuristic-only build, no formula-only classifier.
2. **SMILES = interface + registry only** — a parser seam, not an implementation. `readSmiles()` returns `{ ok: false, reason, parser }` until a parser is registered, and never throws (a missing, declining, or throwing parser all become a result).
3. **No `chem structure` command** — structure facts (fragments, bonds, source, confidence) render inside the `classify` card. Keeps the M3 command surface to one new command.
4. **Version 0.3.0** at the end of the milestone.

**Design (layers L1/L2, pure functions, no new runtime deps):**

| File | Role |
|---|---|
| `src/structure/molecule.ts` | `Atom`/`Bond`/`Molecule` graph model + helpers (`neighbors`, `components`, `ringCount`, `netCharge`, `formulaString`) |
| `src/structure/valence.ts` | preferred valences, valence states, common charges per element + `isMetal`/`isHalogen`/`isChalcogen`/`isNobleGas`/`isPnicogen` predicates |
| `src/structure/dsl.ts` | a tiny element-only notation for writing templates (`parseStructure`/`parseIonSet`) — chains, `=`/`#` prefixes, `%digit` ring closures, additive charges, `(H)`/`H<n>` hydrogen modifiers |
| `src/structure/templates.ts` | Tier A curated exact structures (73), registry keyed by Hill-order formula, each entry also carrying its conventional written formula + display name |
| `src/structure/fromFormula.ts` | Tier B/C builder: hydrate split, ion pairs (anion-charge-driven, incl. ammonium runs), chain construction, empirical fallback |
| `src/structure/smiles.ts` | `SmilesParser` interface + `setSmilesParser` registry (extension point) |
| `src/knowledge/classify.ts` | `classify(formula) → Classification` = `{ input, formula, primary, classes[], reasoning[], caveats[], fromStructure, structure, molarMass }` |

**Core contract — `StructureBuild`:** `{ formula, molecule \| null, source: "template" \| "constructed" \| "empirical", confidence: "high" \| "medium" \| "low", notes: string[] }`. It **never throws** for a formula the parser accepts; an unknown structure surfaces as `empirical` + a note, per §3 ("unknowns are surfaced, never guessed").

**Classes:** acid, base, salt, metal, oxide, hydroxide, water, hydrocarbon, alcohol, aldehyde, ketone, carboxylic-acid, ester, ether, amine, aromatic, hydrate, plus two added during T7 because common species otherwise fell through to "unknown": **element** (a simple substance, `N2`/`O2`/`S8`/`H2`; a bare metal also reports it) and **peroxide** (an O–O bond, `H2O2`; `Na2O2` reports salt first, peroxide second). Reasoning strings cite the structural evidence (e.g. "2 hydroxyls on oxygen bonded to S: an oxoacid, ionisable in water"), never a bare label. `reasoning[i]` explains `classes[i]`; `caveats[]` carries the limits — an ambiguous formula (`C2H6O` fits ethanol *and* dimethyl ether) or a classification made from the formula alone because no connectivity could be built.

**Acceptance:** `chem classify "H2SO4"` → `acid` + reasoning; one classifier test per class plus negatives; every new module has tests; `npm test` + `npx tsc --noEmit` green; live-terminal `classify` check; committed + pushed as `M3: … (v0.3.0)`.

**Task table:**
- [x] T1 — plan doc: this section + §10 status row + triage the stray `BUG REPORT 4-42-25-9-2026.txt` (all three bugs fixed in v0.2.5).
- [x] T2 — `data/elements.json` += `group`/`period` (additive optional fields; `scaffold.test.ts` untouched) + `groupOf`/`periodOf`; new `tests/elements.test.ts`.
- [x] T3 — `structure/valence.ts`: valence states + metal/halogen/alkali/chalcogen predicates + tests.
- [x] T4 — `structure/molecule.ts`: graph model, helpers, `formulaString` round-trip, multi-fragment salts + tests.
- [x] T5 — `structure/dsl.ts` + `structure/templates.ts`: the template notation, 65 Tier A curated structures + registry, each round-trips to its own formula + tests.
- [x] T6 — `structure/fromFormula.ts`: hydrate split, ion pairs, charge model, chain construction, empirical fallback (`CH4`, `C6H12O6`, `Ca(OH)2`, `CuSO4·5H2O`, `NH4Cl`) + tests.
- [x] T7 — `knowledge/classify.ts` + evidence-based reasoning; one test per class + negatives.
- [x] T8 — `structure/smiles.ts`: parser interface + registry, "not installed" path + tests.
- [x] T9 — CLI `chem classify` + result card; help/examples/guide/`PLANNED` updates + cli/repl tests.
- [x] T10 — TUI touch-ups: classify card header, guide line, completions/palette tests.
- [x] T11 — version 0.3.0 + README (classify section, milestone row, architecture tree) + plan §10.
- [x] T12 — full gate (`npm test` 396/26 files + `npx tsc --noEmit` clean), console check via piped stdin (`classify H2SO4` / `C2H6O` / `XeF2` all render), commit + push.

### M4 — Prediction (rules + thermodynamics)

**Decisions (2026-09-26, user-approved):**
1. **Phases are first-class.** `data/thermo.json` carries one ΔGf° per phase per species (`H2O`: `l`/`g`/`aq`), and rules emit a phase for every species they propose, so a prediction reads `CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)`. This is not decoration: with `H2O(g)` the methane combustion comes out at −800.8 kJ/mol, and the milestone's acceptance value (−818) is the **liquid** water figure. `StoichTerm.state` already exists in `core/equation.ts`; M4 is what finally populates it.
2. **All six §5 rules ship in M4**, one rule per task. Combination and decomposition are **curated reaction tables**, not generated chemistry: a formula cannot tell us that `CaCO3` is the one carbonate that decomposes at 298 K. A new reaction is a new entry, never a new guess — the same "curated, not inferred" stance `structure/templates.ts` took.
3. **Both awkward outcomes are stated, not swallowed** (§3). A pair that cannot react reports *why* ("no precipitate forms", "Cu sits below H in the reactivity series"); a candidate whose ΔGf° is missing is ranked **after** every known one and labelled `ΔG unknown`. A silent empty list would read as "nothing happens", which is the confident-wrong-answer the plan forbids.
4. **Thermo data is written from standard references, then the pinned values are checked against NIST WebBook** (§6, §6a). Every entry carries its own `source`; the ~20 values the tests pin are the ones verified. No network at runtime.
5. **`chem predict` *and* `chem feasibility`** — the second is 20 lines: balance an equation the user wrote, then judge it. It exercises thermo without inventing reactants, and it is the natural sibling of `chem balance`.
6. **Version 0.4.0** at the end of the milestone.

**Design (layers L3/L4, pure functions, no new runtime deps):**

| File | Role |
|---|---|
| `data/thermo.json` | ΔGf° per species per phase, kJ/mol @ 298.15 K, each entry with `name` + `source` |
| `src/thermo/table.ts` | loads the table, indexes by canonical Hill key + phase, `dGfOf(formula, state?)` |
| `src/thermo/thermo.ts` | `reactionGibbs(BalancedEquation)` — Σ n·ΔGf°(products) − Σ n·ΔGf°(reactants) over `util/rational.ts` |
| `src/thermo/feasibility.ts` | `assess` one candidate, `rank` the set; each carries its own explanation |
| `src/rules/types.ts` | `ReactionRule`, `PredictContext`, `SpeciesInput`, `Proposal`, `Candidate` |
| `src/rules/ions.ts` | cation/anion split from a `StructureBuild` (a real graph, not string surgery) + salt building |
| `src/rules/series.ts` | the reactivity series, with H as the hydrogen line |
| `src/rules/solubility.ts` | solubility rules + the Ag/Pb/Hg exceptions |
| `src/rules/combustion.ts` | `hydrocarbon + O2 -> CO2 + H2O` |
| `src/rules/neutralization.ts` | `acid + base -> salt + water` (keys off the classifier, not the formula string) |
| `src/rules/singleDisplacement.ts` | `metal + salt/acid -> new salt + metal/H2`, gated by the series |
| `src/rules/doubleDisplacement.ts` | `salt + salt -> ...` where one product precipitates |
| `src/rules/combination.ts` | curated: `H2 + O2`, `Na + Cl2`, `C + O2`, `NH3 + HCl`, … |
| `src/rules/decomposition.ts` | curated: `CaCO3 -> CaO + CO2`, `H2O2 -> H2O + O2`, `KClO3 -> KCl + O2`, … |
| `src/rules/ruleEngine.ts` | runs **every** applicable rule, dedupes, balances each proposal, records skip reasons |

**Core contracts.** A rule is declarative in two beats: `applies(ctx)` is a cheap class-level check, `propose(ctx)` returns proposals with phases. `predict(ctx) → { candidates, noReaction[], rules[] }` where a `Candidate` is `{ rule, balanced, skipReason? }` — the engine balances rather than trusting a rule to emit correct coefficients, so a wrong rule surfaces as a skip reason instead of a wrong equation. `reactionGibbs` **never throws** for a species it lacks: `known: false` plus the list of what is missing. `assess` returns a verdict in `{ spontaneous, marginal, nonspontaneous, unknown }` (`marginal` = \|ΔG\| under a small threshold, where a standard-state number says little); `rank` sorts known candidates by ascending ΔG and puts unknown-ΔG ones last, flagged.

**Acceptance:** `chem predict "CH4 O2"` → ranked candidates with ΔG + reasoning; `chem feasibility "H2 + 1/2O2 -> H2O(g)"` → the phase-sensitive counterpart; ΔG tests match textbook values (`CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)` = **−817.9 kJ/mol**; `CaCO3 -> CaO + CO2` = **+131.1**, correctly non-spontaneous); positive *and* negative cases for all six rules; a test that every species any rule can propose has a ΔGf° entry; `npm test` + `npx tsc --noEmit` green; live-terminal check; committed + pushed as `M4: … (v0.4.0)`.

**Task table** (one task at a time, gate after each: `npx vitest run <file>` + `npx tsc --noEmit`):
- [x] T1 — plan doc: this section + §10 status row.
- [x] T2 — `src/thermo/table.ts` (loader, canonical Hill keys, phase index) + a seed `data/thermo.json` (~30 species covering the tests) + `tests/thermo-table.test.ts` (every entry parses, key round-trips, phases ∈ s/l/g/aq, element reference states are 0, no duplicates).
- [x] T3 — grow `data/thermo.json` rule family by rule family until it covers every proposal; NIST WebBook check on the values the tests pin. Done: 117 species, and the aqueous half is machine-verified — `tests/thermo-table.test.ts` re-derives all 31 aqueous salts from the ion values the structure layer finds in them (max deviation 0.05 kJ/mol), so a transcription slip cannot survive. Ions are first-class entries to make that possible; the charge suffix is parsed in `table.ts`. Values checked against NIST/CODATA or an independent Ksp/Hess cross-check, and four that could not be stood behind (KCl/KClO3, dichromate, three uncertain solid values) were left out rather than guessed.
- [x] T4 — `src/thermo/thermo.ts` + `tests/thermo.test.ts` (methane −817.9, C −394.4, H2 −237.1, CaCO3 +131.1, HCl+NaOH, an `H2O(l)` vs `H2O(g)` pair, and missing-species → `unknown`). Done: `reactionGibbs(BalancedEquation)` returns `{ known, dGrxn, dGrxnKj, missing[], terms[] }`, summed in exact `Rational`s. The acceptance number lands — `CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)` = **−817.9** (exactly −8179/10), and with water vapour −800.8, a 17.12 kJ/mol swing that exists only because phases are looked up rather than assumed. The exactness is not decoration: the BaSO4 precipitation sums to −56.81 exactly, where adding the binary doubles in the obvious order gives −56.809999999999945. A missing species or unnamed phase gives `known: false`, the species that blocked it with the reason, and **no total at all** — never a zero in the sum. CaCO3 comes out +131.01 from the table against the +131.1 in the text above, so that assertion carries a tolerance.
- [x] T5 — `src/rules/types.ts` + `src/rules/ions.ts` (cation/anion split from a structure, salt building from ion formulas) + tests. Done: the rule contract is `applies` (cheap gate) / `propose` → `{ proposals, declined }`, with `parseSpeciesInput` taking a typed `(aq)` off and keeping it, and `speciesPairs` for the pair walk every rule does. Ions come off the **graph** — `structure/` already builds salts as fragments with formal charges — and the display spelling comes from the connectivity, which is what turns the sulfate fragment into `SO4` and the hydroxide into `OH` instead of Hill-order `O4S`/`HO`. `buildSalt` gets the ratio from charge balance and brackets a repeated group rather than scaling its subscripts (`Al2(SO4)3`, never `Al2(O12S3)`), and the end-to-end test proves a salt rebuilt from its own ions lands on the **same ΔGf° the table already had** for it. Stated limit: the cation is written first, so an organic salt reads `NaCH3COO` — same species, same value (the table is keyed on counts), machine spelling. One charge reader in the engine: `splitChargedFormula` is now exported from `thermo/table.ts` so the rules layer cannot grow a parser that disagrees about `SO42-`.
- [x] T6 — `src/rules/series.ts` + `src/rules/solubility.ts` + tests. Done: the reactivity series as a curated table (most reactive first, H as the acid line) with verdicts that carry their sentence — "Cu sits below Zn in the reactivity series, so it cannot displace it" — and `undefined` for a metal that is *not* on the list, which is a different answer from "no". The solubility table is the classic five rules; which row a salt falls on is read off the graph via `splitIons`, and "is it Group 1" is asked of the elements table rather than a hand-kept list, while the exceptions stay written out because that is the measured part. Four declines are used deliberately: no ion structure, two kinds of cation (real input — `Ag2CrO4` comes out of the structure layer as Ag⁺ + Cr²⁺ + 4 O⁻), an anion no rule covers (`CrO4`), and a mercury halide, where HgCl₂ and Hg₂Cl₂ are opposites and the oxidation state is not in the formula. `solubilityGap` shares one explanation with `solubilityOf`, so a decline cannot blame the wrong ion. The suite pins the table against the textbook order and all 105 ordered pairs, and cross-checks the rules with `data/thermo.json` both ways: every salt the rules call soluble has an aqueous ΔGf°, and every solid-only salt is called insoluble — with `Na2O` written down as the exception, because a Group 1 oxide is solid-only in the table for the opposite reason (it reacts with water rather than dissolving in it) and a blanket assertion would have forced a wrong answer.
- [x] T7 — `src/rules/combustion.ts` + tests (CH4, C2H6, C6H6; negatives: no O2, not a hydrocarbon). Done: the fuel test is an **element test** (C and H present), not a class label, because any C/H/O molecule burns to the same two products — which is how glucose and ethanol get correct equations, and why a rule can never be the reason a coefficient is wrong (it writes none; the balancer supplies them). `CH4 + O2 -> CO2 + 2H2O(l)` reads **−817.9**, and benzene (−6404.1) and ethanol (−1325.9) go down the same path to their own textbook figures. The fuel's phase is **asked for, not guessed**: the typed `(g)`/`(l)` wins, failing that the phase the table already holds (CH4(g), C6H6(l)), and a fuel the table has never heard of gets no phase at all — glucose and heptane are proposed with the phase left off, come back `known: false`, and get ranked last as unknown-ΔG candidates. Declines are first-class: missing oxygen, a chlorinated or nitrogenous fuel (naming the element, because the equation would be missing HCl or N2), and carbon-with-no-hydrogen pointed at T11's combination table. Oxygen is deliberately *not* part of the gate, so `chem predict "CH4"` reports the missing O2 instead of shrugging.
- [x] T8 — `src/rules/neutralization.ts` + tests (HCl+NaOH, H2SO4+Ca(OH)2, CH3COOH+NaOH; negatives: acid+acid, base+base, salt+base). Done: the acid's anion is a **curated table** (`ACID_ANIONS`, 12 acids keyed on the canonical formula) because HCl and CH3COOH are neutral molecules and nothing in a formula says sulphuric acid hands over two protons to leave SO₄²⁻; the tests **re-derive every entry from the acid itself** (acid = anion + its protons, charge = −protons, element for element), so a typo cannot survive. The base's cation comes **off the graph** (NaOH→Na⁺, Ca(OH)₂→Ca²⁺), which is the same source the structure layer owns. The salt's phase is decided by **T6's solubility table**, so neutralisation and double displacement can never disagree: CaSO₄ comes out at −183.5 with the (s) the solubility rules give it. Values pinned: HCl+NaOH **−79.89**, H₂SO₄+Ca(OH)₂ **−183.46**, CH₃COOH+NaOH **−52.8**. Declines are first-class and cover the plan's negatives plus the ones the chemistry forces: a lone acid/base says its partner is missing, two acids/two bases have no partners, ammonia is refused ("no hydroxide ion — it forms a salt directly, not salt plus water"), a carbonate is pointed at its three-product reaction (walking every species, since Na₂CO₃ classifies as a *salt*, not a base), and boric acid says plainly that no anion is known for it. A typed phase wins: `NaOH(s) + HCl` prices at −119.5.
- [x] T9 — `src/rules/singleDisplacement.ts` + tests (Zn+CuSO4, Fe+CuSO4, Zn+HCl, Na+H2O; negatives: Cu+ZnSO4, Cu+HCl). Done: metal + (salt | acid | cold water) → new salt + (metal | H₂), both series questions answered by T6 — and the **no's carry the reason**: "Cu sits below Zn in the reactivity series, so it cannot displace it", "Cu sits below hydrogen…", "Zn cannot displace itself". Values pinned: Zn+CuSO₄ **−212.55**, Fe+CuSO₄ **−144.39**, Cu+AgNO₃ **−88.73** (and it makes **Cu(NO₃)₂, not the cuprous salt** — the charge table's one true test), Al+CuSO₄ **−1163.87** (crossing the 3+/2+ boundary), Zn+HCl **−147.06** (T4's own value), Na+H₂O **−364.02** (curated cold-water metals: K/Na/Li/Ca; the others get "needs steam, which this rule does not write"), and Pb+CuSO₄ comes out **PbSO₄(s)** — the new salt's phase is the shared T6 `saltPhase`, moved into solubility.ts so T8, T9, T10 cannot disagree. The displaced charge is a curated table (`DISPLACEMENT_CHARGE`, same stance as `ACID_ANIONS`) because `valence.ts`'s first-positive rule would make the cupric cuprous; tests re-derive all 14 sulfates and land them on the thermo table. A metal with no series position gets the honest decline ("W has no place in the reactivity series, so whether it displaces anything cannot be judged") — why the gate uses `isMetal`, wider than `seriesMetal`. A base is not a displacement partner (NaOH → "needs a salt, an acid or water"), and alkali-metal salt displacements carry the caveat that the metal would also react with the water itself — only the displacement is priced.
- [x] T10 — `src/rules/doubleDisplacement.ts` + tests (AgNO3+NaCl, BaCl2+Na2SO4; negative: NaCl+KNO3, both soluble). Done: two salts swap their ions and a product that cannot dissolve drives the reaction. Pinned: AgNO₃+NaCl **−55.67** and BaCl₂+Na₂SO₄ **−56.81** (both among T4's M4 pins), Na₂CO₃+CaCl₂ → **CaCO₃(s)** **−47.44** (carbonates classify as salts, so they run through the swap), Pb(NO₃)₂+Na₂SO₄ → **PbSO₄(s)** **−43.97**. Partners are species the classifier calls salts and the ion reader can split into one cation kind + one anion kind (FeCl₃ fine; **KAl(SO₄)₂ is not** — two cation kinds, the card says so). The no's carry reasons and never overclaim: NaCl+KNO₃ names the dissolved products ("the swap makes NaNO₃(aq) and KCl(aq), which stay dissolved — with no precipitate, nothing drives a reaction"); a shared ion hands back the same salts; an insoluble reactant (AgCl, CaCO₃) cannot meet its partner in solution; and when solubility cannot judge a product (AgMnO₄), the decline says **cannot judge**, never "no reaction". The precipitate leads the products on the card. Also folded each rule's private decline-dedup into one shared `uniqueDeclines` in types.ts (three copies → one). NH4Cl+AgNO₃ proposes AgCl(s)+NH4NO₃ but is priced **unknown** — NH4NO₃ has no ΔGf° entry; the proposal survives and the gap is named.
- [x] T11 — `src/rules/combination.ts` + `src/rules/decomposition.ts` curated tables + tests. Done: combination is a **curated table** (the same stance ACID_ANIONS takes — nothing in a formula says Mg lands on MgO but N₂ must not be written), 16 known reactions written with the states they use; formulas stay textbook-friendly and are canonicalised once at load, so `SO2`/`O2S` and `N2`/`H3N` are the same key and the contact process cannot vanish behind Hill order. Every entry was matched against the thermo table first, so each has a pinned number except the ones that honestly cannot: H₂+Cl₂→2HCl(g), NH₃+HCl→NH₄Cl(s) and NO+O₂→2NO₂(g) are proposed (the white smoke test and the brown gas test are too famous to drop) but come back `known: false` with the missing ΔGf° named — the table holds only HCl(aq) and no NO, and that is said, never guessed. Pinned: Mg+O₂ **−1138.6**, H₂+O₂ **−474.26**, C+O₂ **−394.36** (T4's own), CaO+CO₂ **−131.01** (the mirror of decomposition's +131.01 — the same ΔGf° values hand it back flipped, a two-way sanity check), CaO+H₂O **−57.94**, Na+Cl₂ **−768.28**, N₂+3H₂→2NH₃ **−32.90**, 2CO+O₂ **−514.40**, 2SO₂+O₂ **−141.62**. The table also knows its noes: the plan's negative N₂+O₂ is declined with the reason written down ("forming NO is endothermic and takes lightning-scale energy"), iron because Fe₂O₃ and Fe₃O₄ are both real and it does not guess between them, and every other pair is told plainly the *curated* table has no entry for it — "no entry" is never silence. Decomposition is the sibling table — CaCO₃ → CaO + CO₂ reads **+131.01** (the positive M4 pin: it needs a kiln), Ca(OH)₂ +66.50, H₂O(ℓ) **+474.26** and NaCl **+768.28** (both "only with an electric current", priced honestly as positives), H₂O₂(ℓ) **−233.46** (the one that falls apart on its own), NH₄Cl proposed but unknown-ΔG (HCl(g) unpriced). Its gate is `species.length === 1` — decomposition answers the single-species question and steps aside when several species are named, so the other rules get to speak. A non-entry single species gets "no decomposition in the curated table for X" instead of a shrug, typed phases win (`NaCl(aq)` reprices at +786.26), and every row exports for T12's coverage cross-check.
- [x] T12 — `src/rules/ruleEngine.ts` (all rules fire, dedupe, balance, skip reasons) + the thermo-coverage cross-check test. Done: `predict(input)` runs the six §5 rules in one fixed, documented order; each proposal is run through the balancer and the outcome is always visible — a balanced `Candidate`, or one with a `skipReason` for an equation that would not parse or balance (a rule bug surfaced, never papered over, and never deduped away). Two rules proposing the identical reaction (same formulas, states, coefficients) keep the first and count the second in `duplicatesDropped`, so the merge is auditable. Declines travel with the result, deduped, so `predict("CH4")` answers *nothing happens* with the reasons ("combustion needs O2", "no decomposition in the curated table for CH4") instead of an empty list that reads as a confident no. End-to-end pins: all six rules' star cases land through the engine (combustion −817.9, neutralization −79.89, single displacement −212.55, double displacement −55.67, combination −1138.6, decomposition +131.01), and the mirror cross-check confirms the engine agrees with itself — CaCO₃ decomposing at +131.01 and CaO + CO₂ combining at −131.01 are the same ΔGf° values read in opposite directions. The coverage cross-check prices **every** curated row in both tables and allows an unknown only when the gap is written down on purpose — exactly two are: HCl(g) (the table holds hydrochloric acid only as (aq)) and NO(g). A typo in a phase or formula (MgO(aq), SO5) is caught as an undocumented gap, and the allowlist cannot rot: each permitted gap must really be hit by some entry or it is removed.
- [x] T13 — `src/thermo/feasibility.ts` (verdicts, ranking, one explanation per candidate) + tests. Done: four verdicts over ΔG_rxn° — **spontaneous** (ΔG ≤ −20 kJ/mol, runs as written), **nonspontaneous** (ΔG ≥ +20, needs energy input), **marginal** in the ±20 kJ/mol band either side of zero (the sign is known but the direction can flip with conditions — the band itself is a documented constant, 20 being the usual rule of thumb), and **unknown** when the table cannot price the reaction (a verdict of its own, never a guessed sign). One explanation per candidate carries the verdict *and* the number that backs it, so the two cannot disagree on the card: "spontaneous (ΔG° = −1138.60 kJ/mol at 298.15 K) — this reaction runs as written", "nonspontaneous (ΔG° = +131.01 kJ/mol …) — it needs energy input…", "cannot be judged — no ΔGf° for HCl(g) — the table has aq, so the ΔG total is unknown". Ranking reads most-favourable-first: known ΔG ascending (−1138.6 Mg+O₂ before −817.9 CH₄ before +131.01 CaCO₃), then every unknown-ΔG candidate after all of them, still labelled, and stable among themselves (H₂+Cl₂ and NH₃+HCl keep their order); a `skipReason` candidate is not a reaction and never ranks. The marginal band is real chemistry, not decoration: NH₃(g) → NH₃(aq) sits at −10.05 and its reverse +10.05 — both true, both marginal.
- [x] T14 — `chem predict` + `chem feasibility` + result cards, `help`/`examples`/guide/`PLANNED`, cli/repl/tui tests. Done: **`chem predict "<species>"`** runs the rule engine, ranks the result most-favourable-first (T13) and prints one result card per candidate — the verdict in rule color, the **balanced equation spelled the way it was written** (2Mg(s) + O₂(g) → 2MgO(s), never the Hill-order forms), the ΔG-backed explanation, and the rule's one-line why. When nothing can happen it is never silence: `predict N2 O2` answers *No reaction expected.* with the declines printed under it (…forming NO is endothermic and takes lightning-scale energy…). Unpriced candidates keep their `unknown` verdict on the card (`predict H2 Cl2` names HCl(g) as the gap). Rule-bug skips render as visible `[rule] skip` lines, and merged duplicates are counted. **`chem feasibility "<equation>"`** prices an equation the user writes: single-phase species resolve to their only phase (`H2 + Cl2 -> HCl` prices HCl(aq) at −262.46), multi-phase species ask for the phase ("H2O has more than one phase (l, g, aq) — say which one"), and a genuinely absent phase names the missing ΔGf°. One-shot, REPL and piped stdin all reach `predict`, help lists both under *Commands* with simulate still under *Planned* ([M5 planned]), the TUI guide's Commands panel auto-lists them and its static line is now "simulate — M5 planned", the command palette drops predict from the planned list (no name twice), and completions pick up `predict`/`feasibility`. Both commands join the live `examples` demos. 687 tests, tsc clean.
- [x] T15 — version 0.4.0 + README (predict/feasibility sections, milestone row, architecture tree) + plan §10. Done: `package.json`/`package-lock.json`/`VERSION` at 0.4.0 (all version-aware tests bumped with them), README gains `### predict` and `### feasibility` usage sections with real output (ranked cards, the no-reaction-with-reason case, the unknown-ΔG card, the honest phase question), the milestone table marks **M4 ✅ done (v0.4.0)**, and the architecture tree updates `rules/`/`thermo/` from planned to shipped (with `data/` now "thermo table", not "thermo table in M4"). Plan §10's M4 row rewritten from "in progress, nothing in the tree" to the full T1–T15 record — thermo table with machine-verified aqueous salts, six rules, curated tables that know their noes, engine/feasibility, the −817.90 / +131.01 pins — and "waiting on T16's final gate + push".
- [x] T16 — full gate (`npm test` + `npx tsc --noEmit`), live-terminal check, commit + push. Done: `npm test` = **687 tests / 41 files green**, `npx tsc --noEmit` clean. Acceptance exercised live: `chem predict "CH4 O2"` → **−817.90** (the ≈−818 liquid-water pin), `chem predict "Mg O2"` → −1138.60 spontaneous, `chem feasibility "CaCO3 -> CaO + CO2"` → **+131.01, nonspontaneous** (the milestone's headline), `chem predict "N2 O2"` → *No reaction expected.* with the curated endothermic-lightning reason. Committed and pushed to `origin/main` as **`M4: prediction (rules + thermodynamics) (v0.4.0)`**.

### M4.2 — Simple materials (v0.4.2)

**Why:** the report `predict Na Cl` → *No reaction expected.* The curated table already held `Na + Cl2 -> NaCl`, but a bare `Cl` was read as monatomic and never matched. Elements are the most ordinary thing a person types, and the six rules were compound-shaped.

**Decisions (2026-09-26, user-approved):** a **dedicated seventh rule** (`simpleMaterials`) with the element + element rows **moved out of `combination`** (one home per question; no dedupe noise); accept seven rules in `ALL_RULES`; **add sourced `FeS(s)`/`ZnS(s)`** (and the other binary solids the new rows need) to `data/thermo.json`.

**Design:**
- `src/rules/elements.ts` — the standard elemental substances: `H→H2, N→N2, O→O2, F→F2, Cl→Cl2, Br→Br2, I→I2`, everything else unchanged. A **definition** (reference states), not a guess; agrees with the thermo table's zeros; applied in the rules layer only, so `classify` is untouched.
- `src/rules/simpleMaterials.ts` — curated **element + element → binary compound**: metal + halogen, metal + oxygen, metal + sulfur, non-metal + non-metal. First-class declines for `N2+O2` (endothermic), `Fe+O2` (two oxides), `Na/K+O2` (peroxide/superoxide), and any pair the table does not hold.
- `combination` keeps only compound-involving joins (`CO+O2`, `SO2+O2`, `NO+O2`, `CaO+H2O`, `CaO+CO2`, `NH3+HCl`) and **skips** element + element pairs.
- `data/thermo.json` gains solid-state values (KCl, CaCl₂, MgCl₂, AlCl₃, ZnCl₂, CuCl₂, FeCl₂, FeCl₃, NaBr, KBr, FeS, ZnS) with their aqueous ion sums where the salt is soluble.

**Task table** (each gated by `npx vitest run <file>` + `npx tsc --noEmit`):
- [x] T1 — plan doc + decision lock.
- [x] T2 — `src/rules/elements.ts` + `tests/rules-elements.test.ts`.
- [x] T3 — `data/thermo.json` solid halides/sulfides + aqueous ion sums; thermo-table tests stay green.
- [x] T4 — `src/rules/simpleMaterials.ts` + `tests/rules-simple-materials.test.ts` (`Na + Cl` → `2NaCl` **−768.28**).
- [x] T5 — re-home the element rows out of `combination`; split the combination/simple-materials suites; extend `thermo-coverage` to both tables.
- [x] T6 — wire `simpleMaterials` into `ALL_RULES` (after `combination`); engine-level `predict("Na Cl")` matches `predict("Na Cl2")`; six → seven wording.
- [x] T7 — REPL + one-shot CLI simple-materials tests; `predict Na Cl` example.
- [x] T8 — version 0.4.2 + README (simple-materials example, milestone rows, layout) + this section.
- [x] T9 — full gate + live check + push.

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
- Combination / decomposition of common compounds — as **curated reaction tables**, not generated chemistry (see M4 decision 2)
- Simple materials: `element + element → binary compound` (curated; a bare element is read as its standard substance, `Cl → Cl2`) — added in **v0.4.2**, see §4 `### M4.2`

New rules = new files implementing `ReactionRule`, no engine changes. The six M4 rules ship one per task; the seventh (`simpleMaterials`) arrives in v0.4.2. The file table, contracts and T2–T16 breakdown are in the `### M4` section of §4.

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
- [x] M2b.2 — TUI polish v0.2.2 (one-row-under-viewport frame, keymap guard against Ink-stripped mouse tails) — 136 tests green, `tsc` clean, pushed; live-terminal check folded into Task 10; select & copy → M2b.4
- [x] M2b.3 — anti-blink v0.2.3 (enable Ink incremental rendering: per-keystroke writes drop to just the input row, no full-frame erase+redraw) — 138 tests green, `tsc` clean, pushed; live-terminal check folded into Task 10
- [x] M2b.4 — select & copy v0.2.4 (drag-select over results → release copies via OSC 52, `~/.chemengine/last-selection.txt` fallback; selection-aware incremental rendering; per-cell highlight parity) — 198 tests green, `tsc` clean, pushed; live check done → its three findings shipped as M2b.5
- [x] M2b.5 — copy/geometry/display-cell fixes v0.2.5 (native `clip.exe` clipboard chain with method-naming toasts; `display.ts` grapheme/display-column line model so wide glyphs and ANSI keep card borders flush; marker-aware `scrollGeometry` reaching the true bottom + `clamp-scroll` on resize) — 220 tests green (18 files), `tsc` clean, live-verified, pushed
- [x] M3 — structure + classification (v0.3.0) — T1–T12 done, pushed: element `group`/`period`; `structure/valence.ts`; `structure/molecule.ts` (hydrogens implicit, no H nodes); `structure/dsl.ts` + 73 curated templates; three-tier `structure/fromFormula.ts` (template → valence-built → empirical, never throws for a parseable formula); `knowledge/classify.ts` (19 classes in specificity order, evidence per class, caveats for ambiguity and for a missing structure); `structure/smiles.ts` (interface + one-slot registry, no parser); `chem classify` + card; TUI palette/completions/guide. 396 tests green (26 files), `tsc` clean. Decided along the way: curated templates + heuristic fallback, SMILES interface+registry only, `classify` as the only new command, and two classes added beyond the planned 17 (`element`, `peroxide`) because common species otherwise fell through to `unknown`.
- [x] M4 — prediction (rules + thermodynamics) — T1–T15 done, waiting on T16's final gate + push (v0.4.0): `data/thermo.json` (117 species, per-phase ΔGf° from NIST/CODATA, aqueous salts machine-verified against the ion values the structure layer finds in them); element reference states priced at 0; `src/thermo/thermo.ts` exact-rational `reactionGibbs` (known/unknown, terms, reasons — a missing species is never a zero); six §5 rules — combustion (element test: any C/H/O fuel), neutralization (acid+base, declines for acid+acid, base+base, ammonia), single displacement (reactivity series + curated cold-water list), double displacement (solubility-driven ion swap), combination and decomposition as **curated tables** that know their noes (N₂+O₂ declined with the endothermic-lightning reason, Fe because Fe₂O₃/Fe₃O₄ ambiguity); `ruleEngine.ts` that balances every proposal, surfaces skips, dedupes, and carries declines so no-reaction is never silence; `feasibility.ts` (spontaneous ≤ −20, nonspontaneous ≥ +20, marginal between, unknown when the table cannot price, ranked most-favourable-first with unknown last); `chem predict` + `chem feasibility` result cards; help/guide/palette/completions/examples all ship the new commands. Pinned through the engine: CH₄ combustion **−817.90**, CaCO₃ decomposition **+131.01** (mirrored by CaO+CO₂ at −131.01 in combination), CaCO₃ ≤ +131.01 → **nonspontaneous** is a headline case. 687 tests green, `tsc` clean through T14; T15 bumped v0.4.0 + README.
- [ ] M5 — kinetics + CLI polish
- [x] M4.1 — predict punctuation fix (v0.4.1): `predict CH4 + O2` (spaced `+`) no longer feeds a bare `+` token to the parser — `contextOf` filters standalone `+` reactant punctuation; regression tests in `rules-engine`, `repl`, `cli`. Pushed as `10b15fd`.
- [x] M4.2 — simple materials (v0.4.2): a seventh rule, `simpleMaterials`, answers **element + element** questions. `src/rules/elements.ts` reads a bare symbol as the standard substance (`Cl → Cl2`), so `predict "Na Cl"` ≡ `predict "Na Cl2"` → `2Na(s) + Cl2(g) -> 2NaCl(s)` at **−768.28**. Curated halide/oxide/sulfide/covalent table (K/Ca/Mg/Al/Zn/Cu/Fe halides, the metal oxides, FeS/ZnS, H₂O/NH₃/CO₂/SO₂) with honest noes (`N2+O2` endothermic, `Fe+O2` two oxides, `Na/K+O2` peroxide/superoxide). The element rows moved out of `combination`, which keeps only compound-involving joins and skips element + element pairs. `data/thermo.json` grew solid-state values for the new products (sourced; aqueous ion sums where soluble). Seven rules in `ALL_RULES` (simpleMaterials after combination). README simple-materials example + milestone rows. 724 tests / 43 files green, `tsc` clean.