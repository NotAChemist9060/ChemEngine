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
- [ ] T2 — `src/thermo/table.ts` (loader, canonical Hill keys, phase index) + a seed `data/thermo.json` (~30 species covering the tests) + `tests/thermo-table.test.ts` (every entry parses, key round-trips, phases ∈ s/l/g/aq, element reference states are 0, no duplicates).
- [ ] T3 — grow `data/thermo.json` rule family by rule family until it covers every proposal; NIST WebBook check on the values the tests pin.
- [ ] T4 — `src/thermo/thermo.ts` + `tests/thermo.test.ts` (methane −817.9, C −394.4, H2 −237.1, CaCO3 +131.1, HCl+NaOH, an `H2O(l)` vs `H2O(g)` pair, and missing-species → `unknown`).
- [ ] T5 — `src/rules/types.ts` + `src/rules/ions.ts` (cation/anion split from a structure, salt building from ion formulas) + tests.
- [ ] T6 — `src/rules/series.ts` + `src/rules/solubility.ts` + tests.
- [ ] T7 — `src/rules/combustion.ts` + tests (CH4, C2H6, C6H6; negatives: no O2, not a hydrocarbon).
- [ ] T8 — `src/rules/neutralization.ts` + tests (HCl+NaOH, H2SO4+Ca(OH)2, CH3COOH+NaOH; negatives: acid+acid, base+base, salt+base).
- [ ] T9 — `src/rules/singleDisplacement.ts` + tests (Zn+CuSO4, Fe+HCl, Na+H2O where curated; negative: Cu+ZnSO4 below the series).
- [ ] T10 — `src/rules/doubleDisplacement.ts` + tests (AgNO3+NaCl, BaCl2+Na2SO4; negative: NaCl+KNO3, both soluble).
- [ ] T11 — `src/rules/combination.ts` + `src/rules/decomposition.ts` curated tables + tests.
- [ ] T12 — `src/rules/ruleEngine.ts` (all rules fire, dedupe, balance, skip reasons) + the thermo-coverage cross-check test.
- [ ] T13 — `src/thermo/feasibility.ts` (verdicts, ranking, one explanation per candidate) + tests.
- [ ] T14 — `chem predict` + `chem feasibility` + result cards, `help`/`examples`/guide/`PLANNED`, cli/repl/tui tests.
- [ ] T15 — version 0.4.0 + README (predict/feasibility sections, milestone row, architecture tree) + plan §10.
- [ ] T16 — full gate (`npm test` + `npx tsc --noEmit`), live-terminal check, commit + push.

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

New rules = new files implementing `ReactionRule`, no engine changes. All six ship in M4, one per task; the file table, contracts and T2–T16 breakdown are in the `### M4` section of §4.

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
- [ ] M4 — prediction (rules + thermodynamics) — **in progress**. T1 done (this section). Nothing else in the tree yet: no `data/thermo.json`, no `src/rules/`, no `src/thermo/`. Decided at the start: phases are first-class (per-phase ΔGf°, states in rule output, because the −818 kJ/mol acceptance value is the liquid-water figure); all six §5 rules ship, one per task; combination/decomposition are curated reaction tables; no-reaction and unknown-ΔG outcomes are both stated explicitly; the pinned ΔG values get a NIST WebBook check before they enter the data file; `chem predict` and `chem feasibility` both ship; version 0.4.0 at the end.
- [ ] M5 — kinetics + CLI polish