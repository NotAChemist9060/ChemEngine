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

> Handoff below is historical (pre-commit M2b.1 planning). Tasks 7–9 are done, Task 10 is the live-terminal step; the M2b.2 block above supersedes it for current work. v0.2.2 is committed — the next code work is M3.

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
- [x] M2b.2 — TUI polish v0.2.2 (one-row-under-viewport frame, keymap guard against Ink-stripped mouse tails) — 136 tests green, `tsc` clean, pushed; live-terminal check folded into Task 10; select & copy → M2b.4
- [x] M2b.3 — anti-blink v0.2.3 (enable Ink incremental rendering: per-keystroke writes drop to just the input row, no full-frame erase+redraw) — 138 tests green, `tsc` clean, pushed; live-terminal check folded into Task 10
- [x] M2b.4 — select & copy v0.2.4 (drag-select over results → release copies via OSC 52, `~/.chemengine/last-selection.txt` fallback; selection-aware incremental rendering; per-cell highlight parity) — 198 tests green, `tsc` clean, pushed; live check done → its three findings shipped as M2b.5
- [x] M2b.5 — copy/geometry/display-cell fixes v0.2.5 (native `clip.exe` clipboard chain with method-naming toasts; `display.ts` grapheme/display-column line model so wide glyphs and ANSI keep card borders flush; marker-aware `scrollGeometry` reaching the true bottom + `clamp-scroll` on resize) — 220 tests green (18 files), `tsc` clean, live-verified, pushed
- [ ] M3 — structure + classification
- [ ] M4 — prediction (rules + thermodynamics)
- [ ] M5 — kinetics + CLI polish