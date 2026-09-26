import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState, reducer, DEFAULT_CONFIG, type TuiAction } from "../src/tui/state.ts";
import { keyToAction, SGR_TAIL_RE, type PressedKey } from "../src/tui/keymap.ts";
import { candidatesFor, commandNames, lastToken } from "../src/tui/completions.ts";
import { filterPalette, paletteItems } from "../src/tui/palette-list.ts";
import { historyPath, loadConfig, loadHistory, saveConfig, saveHistory } from "../src/tui/persist.ts";
import { layout, MIN_CHROME_ROWS, MIN_GUIDE_COLUMNS } from "../src/tui/layout.ts";
import { guideSections } from "../src/tui/guide.ts";
import { TUI_RENDER_OPTIONS } from "../src/tui/index.ts";

function press(p: PressedKey, input = ""): { input: string; key: PressedKey } {
  return { input, key: p };
}

/** A reducer state with an active drag selection over the results viewport. */
function selected() {
  let s = initialState();
  s = reducer(s, { type: "select-start", row: 1, col: 1 });
  return reducer(s, { type: "select-extend", row: 2, col: 3 });
}

describe("TUI keymap", () => {
  it("maps navigation and editing keys", () => {
    expect(keyToAction("", { return: true })).toBe("submit");
    expect(keyToAction("", { escape: true })).toBe("cancel");
    expect(keyToAction("", { tab: true })).toBe("complete");
    expect(keyToAction("", { backspace: true })).toBe("backspace");
    expect(keyToAction("", { delete: true })).toBe("delete");
    expect(keyToAction("", { upArrow: true })).toBe("history-up");
    expect(keyToAction("", { downArrow: true })).toBe("history-down");
    expect(keyToAction("", { pageUp: true })).toBe("scroll-up");
    expect(keyToAction("", { pageDown: true })).toBe("scroll-down");
    expect(keyToAction("", { home: true })).toBe("home");
    expect(keyToAction("", { end: true })).toBe("end");
    expect(keyToAction("", { leftArrow: true })).toBe("left");
    expect(keyToAction("", { rightArrow: true })).toBe("right");
  });

  it("maps modifier combos before plain text", () => {
    expect(keyToAction("c", { ctrl: true })).toBe("exit");
    expect(keyToAction("C", { ctrl: true, shift: true })).toBe("exit");
    expect(keyToAction("l", { ctrl: true })).toBe("clear-results");
    expect(keyToAction("g", { ctrl: true })).toBe("toggle-guide");
  });

  it("falls through to text insertion", () => {
    expect(keyToAction("b", {})).toBe("insert");
    expect(keyToAction("", {})).toBeNull();
  });

  it("drops raw escape sequences (SGR mouse reports) but keeps lone ESC as cancel", () => {
    expect(keyToAction("\u001b[<0;1;1M", {})).toBeNull();
    expect(keyToAction("\u001b[<65;5;8M", {})).toBeNull();
    expect(keyToAction("", { escape: true })).toBe("cancel");
    expect(keyToAction("\u001b[<0;3;7m", {})).toBeNull();
  });

  it("drops Ink-stripped SGR mouse tails so clicks never litter the input line", () => {
    // Ink strips the leading ESC before useInput (use-input.js), so mouse
    // reports arrive as bare tails — these must never become "insert".
    expect(keyToAction("[<0;1;1M", {})).toBeNull(); // left press
    expect(keyToAction("[<0;3;7m", {})).toBeNull(); // left release
    expect(keyToAction("[<65;5;8M", {})).toBeNull(); // wheel down
    expect(keyToAction("[<64;20;30M", {})).toBeNull(); // wheel up
    // Guard regex sanity: it matches the tails above.
    expect(SGR_TAIL_RE.test("[<0;1;1M")).toBe(true);
    expect(SGR_TAIL_RE.test("[<0;3;7m")).toBe(true);
    expect(SGR_TAIL_RE.test("hello")).toBe(false);
  });
});

describe("TUI reducer", () => {
  it("inserts text at the cursor", () => {
    let s = initialState();
    s = reducer(s, { type: "insert", text: "H2" });
    expect(s.input).toBe("H2");
    expect(s.cursor).toBe(2);
    s = reducer(s, { type: "left" });
    s = reducer(s, { type: "insert", text: "O" });
    expect(s.input).toBe("HO2");
    expect(s.cursor).toBe(2);
  });

  it("backspaces before the cursor and deletes at the cursor", () => {
    let s = initialState();
    s = reducer(s, { type: "insert", text: "abc" });
    s = reducer(s, { type: "backspace" });
    expect(s.input).toBe("ab");
    s = reducer(s, { type: "left" });
    s = reducer(s, { type: "delete" });
    expect(s.input).toBe("a");
  });

  it("records results and command history on submit", () => {
    let s = initialState();
    s = reducer(s, { type: "insert", text: "balance H2 + O2 -> H2O" });
    s = reducer(s, { type: "submit", command: "balance H2 + O2 -> H2O", output: "2H2 + O2 -> 2H2O", ok: true });
    expect(s.results).toHaveLength(1);
    expect(s.results[0]?.output).toBe("2H2 + O2 -> 2H2O");
    expect(s.input).toBe("");
    expect(s.inputHistory).toEqual(["balance H2 + O2 -> H2O"]);
  });

  it("recalls command history with up/down", () => {
    let s = initialState();
    s = reducer(s, { type: "submit", command: "element O", output: "O", ok: true });
    s = reducer(s, { type: "submit", command: "element Fe", output: "Fe", ok: true });
    s = reducer(s, { type: "history-up" });
    expect(s.input).toBe("element Fe");
    s = reducer(s, { type: "history-up" });
    expect(s.input).toBe("element O");
    s = reducer(s, { type: "history-down" });
    expect(s.input).toBe("element Fe");
    s = reducer(s, { type: "history-down" });
    expect(s.input).toBe("");
  });

  it("cycles tab completions", () => {
    let s = initialState();
    s = reducer(s, { type: "insert", text: "bal" });
    s = reducer(s, { type: "complete", candidates: ["balance", "element"], cycle: 0 });
    expect(s.input).toBe("balance");
    s = reducer(s, { type: "complete", candidates: ["balance", "element"], cycle: 1 });
    expect(s.input).toBe("element");
  });

  it("starts pinned to the newest output (autoscroll) and scrolls by rows within [0, max]", () => {
    let s = initialState();
    expect(s.scrollTop).toBeNull();
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(12); // page up from the bottom
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(4);
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(0); // clamped at the oldest row
    s = reducer(s, { type: "scroll-down", max: 20, page: 8 });
    expect(s.scrollTop).toBe(8);
    s = reducer(s, { type: "wheel-up", max: 20, step: 3 });
    expect(s.scrollTop).toBe(5);
    s = reducer(s, { type: "wheel-down", max: 20, step: 3 });
    expect(s.scrollTop).toBe(8);
  });

  it("clamps an existing offset after resize and re-pins the bottom", () => {
    let s = initialState();
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(12);

    // A larger content window leaves a valid offset untouched.
    s = reducer(s, { type: "clamp-scroll", max: 20 });
    expect(s.scrollTop).toBe(12);

    // A smaller window clamps the stale offset to its new bottom, which is
    // represented by the autoscroll sentinel rather than a redundant number.
    s = reducer(s, { type: "clamp-scroll", max: 8 });
    expect(s.scrollTop).toBeNull();

    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(12);
    s = reducer(s, { type: "clamp-scroll", max: 5 });
    expect(s.scrollTop).toBeNull();

    // A pinned viewport stays pinned when the geometry changes.
    expect(reducer({ ...s, scrollTop: null }, { type: "clamp-scroll", max: 0 }).scrollTop).toBeNull();
  });

  it("re-pins to autoscroll (null) when scrolling reaches the bottom", () => {
    let s = initialState();
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(12);
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(4);
    s = reducer(s, { type: "scroll-down", max: 20, page: 8 });
    expect(s.scrollTop).toBe(12);
    s = reducer(s, { type: "scroll-down", max: 20, page: 8 });
    expect(s.scrollTop).toBeNull(); // 20 == max → pinned to newest again
  });

  it("resets to autoscroll on submit and clear-results", () => {
    let s = initialState();
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(12);
    s = reducer(s, { type: "submit", command: "balance H2 + O2 -> H2O", output: "2H2 + O2 -> 2H2O", ok: true });
    expect(s.scrollTop).toBeNull();
    s = reducer(s, { type: "scroll-up", max: 20, page: 8 });
    expect(s.scrollTop).toBe(12);
    s = reducer(s, { type: "clear-results" });
    expect(s.scrollTop).toBeNull();
    expect(s.results).toHaveLength(0);
  });

  it("clamps the click-positioned cursor to the input length", () => {
    let s = initialState();
    s = reducer(s, { type: "insert", text: "balance" });
    s = reducer(s, { type: "set-cursor", index: 1 });
    expect(s.cursor).toBe(1);
    s = reducer(s, { type: "set-cursor", index: 99 });
    expect(s.cursor).toBe(7); // clamped to input length
    s = reducer(s, { type: "set-cursor", index: -3 });
    expect(s.cursor).toBe(0);
  });

  it("opens, edits, and applies the palette", () => {
    let s = initialState();
    s = reducer(s, { type: "palette-toggle" });
    expect(s.paletteOpen).toBe(true);
    s = reducer(s, { type: "palette-insert", text: "bal" });
    expect(s.paletteQuery).toBe("bal");
    s = reducer(s, { type: "palette-select-into-input", command: "balance" });
    expect(s.paletteOpen).toBe(false);
    expect(s.input).toBe("balance ");
  });

  it("toggles the guide panel", () => {
    let s = initialState();
    expect(s.guideOn).toBe(true);
    s = reducer(s, { type: "toggle-guide" });
    expect(s.guideOn).toBe(false);
    s = reducer(s, { type: "toggle-guide" });
    expect(s.guideOn).toBe(true);
  });

  it("clears results", () => {
    let s = initialState();
    s = reducer(s, { type: "submit", command: "x", output: "y", ok: true });
    s = reducer(s, { type: "clear-results" });
    expect(s.results).toHaveLength(0);
  });

  it("starts with no active selection", () => {
    expect(initialState().selection).toBeNull();
  });

  it("pins anchor = active on select-start and moves only the active corner on select-extend", () => {
    let s = initialState();
    s = reducer(s, { type: "select-start", row: 3, col: 2 });
    expect(s.selection).toEqual({ anchorRow: 3, anchorCol: 2, activeRow: 3, activeCol: 2 });
    s = reducer(s, { type: "select-extend", row: 5, col: 7 });
    expect(s.selection).toEqual({ anchorRow: 3, anchorCol: 2, activeRow: 5, activeCol: 7 });
    s = reducer(s, { type: "select-extend", row: 3, col: 2 });
    expect(s.selection).toEqual({ anchorRow: 3, anchorCol: 2, activeRow: 3, activeCol: 2 });
  });

  it("is a no-op when extending without a live selection", () => {
    const s = initialState();
    expect(reducer(s, { type: "select-extend", row: 1, col: 1 })).toBe(s);
  });

  it("clears the selection on select-cancel", () => {
    let s = reducer(initialState(), { type: "select-start", row: 1, col: 1 });
    s = reducer(s, { type: "select-extend", row: 3, col: 4 });
    expect(s.selection).not.toBeNull();
    s = reducer(s, { type: "select-cancel" });
    expect(s.selection).toBeNull();
    // Already null → same object, no churn.
    expect(reducer(s, { type: "select-cancel" })).toBe(s);
  });

  it("clears the selection on typing, scrolling, submitting, clearing, and guide toggles", () => {
    const cases: TuiAction[] = [
      { type: "insert", text: "x" },
      { type: "backspace" },
      { type: "delete" },
      { type: "complete", candidates: ["balance"], cycle: 0 },
      { type: "submit", command: "element O", output: "O", ok: true },
      { type: "clear-results" },
      { type: "scroll-up", max: 20, page: 8 },
      { type: "scroll-down", max: 20, page: 8 },
      { type: "wheel-up", max: 20, step: 3 },
      { type: "wheel-down", max: 20, step: 3 },
      { type: "clamp-scroll", max: 20 },
      { type: "toggle-guide" },
    ];
    for (const action of cases) {
      const s = reducer(selected(), action);
      expect(s.selection, `${action.type} should clear the selection`).toBeNull();
    }
  });

  it("keeps the selection object across caret moves, palette-close, clear-input, and history recall", () => {
    const cases: TuiAction[] = [
      { type: "left" },
      { type: "right" },
      { type: "home" },
      { type: "end" },
      { type: "palette-close" },
      { type: "clear-input" },
      { type: "history-up" },
      { type: "history-down" },
    ];
    for (const action of cases) {
      const before = selected();
      const after = reducer(before, action);
      expect(after.selection, `${action.type} should preserve the selection object`).toBe(before.selection);
    }
  });

  it("clears the selection when the palette opens but preserves it when it closes", () => {
    let s = selected(); // palette closed, selection active
    s = reducer(s, { type: "palette-toggle" });
    expect(s.paletteOpen).toBe(true);
    expect(s.selection).toBeNull();
    s = reducer(s, { type: "select-start", row: 1, col: 1 });
    s = reducer(s, { type: "palette-toggle" });
    expect(s.paletteOpen).toBe(false);
    expect(s.selection).toEqual({ anchorRow: 1, anchorCol: 1, activeRow: 1, activeCol: 1 });
  });
});

describe("TUI completions", () => {
  it("exposes command names", () => {
    expect(commandNames()).toContain("balance");
    expect(commandNames()).toContain("element");
    expect(commandNames()).toContain("classify");
  });

  it("finds the last token", () => {
    expect(lastToken("balance CH4 + O")).toBe("O");
    expect(lastToken("" )).toBe("");
  });

  it("completes the first word with commands", () => {
    expect(candidatesFor("")).toContain("balance");
    expect(candidatesFor("bal")).toEqual(expect.arrayContaining(["balance"]));
    expect(candidatesFor("clas")).toEqual(["classify"]);
  });

  it("completes later words with element symbols", () => {
    expect(candidatesFor("element Fe")).toContain("Fe");
    expect(candidatesFor("balance CH4 + O")).toContain("O");
  });
});

describe("TUI palette list", () => {
  it("lists every command plus meta entries", () => {
    const names = paletteItems().map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["balance", "element", "help", "exit", "classify"]));
  });

  it("lists no name twice", () => {
    // classify is a real command now, so the hardcoded planned list must not
    // also claim it or the palette would offer it in two places.
    const names = paletteItems().map((i) => i.name);
    expect(names).toHaveLength(new Set(names).size);
    expect(names.filter((n) => n === "classify")).toHaveLength(1);
  });

  it("still offers what is not built yet", () => {
    const names = paletteItems().map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["predict", "simulate"]));
  });

  it("filters by substring", () => {
    expect(filterPalette(paletteItems(), "bal").map((i) => i.name)).toContain("balance");
    expect(filterPalette(paletteItems(), "zzz")).toHaveLength(0);
    expect(filterPalette(paletteItems(), "")).toHaveLength(paletteItems().length);
  });
});

describe("TUI layout math", () => {
  it("shows all chrome on a large terminal with an exact center viewport", () => {
    const l = layout(40, 160, true);
    expect(l.showBanner).toBe(true);
    expect(l.showInfo).toBe(true);
    expect(l.showGuide).toBe(true);
    expect(l.guideWidth).toBeGreaterThanOrEqual(30);
    expect(l.viewportRows).toBe(40 - 5 - 1 - 1 - 3); // 30
    expect(l.inputRow).toBe(37); // bottom row minus the 3 footer rows
  });

  it("caps the guide width at 48 columns", () => {
    expect(layout(60, 200, true).guideWidth).toBe(48);
  });

  it("hides the guide on narrow terminals", () => {
    const l = layout(60, MIN_GUIDE_COLUMNS - 1, true);
    expect(l.showGuide).toBe(false);
    expect(l.guideWidth).toBe(0);
  });

  it("hides the guide on short terminals even when wide", () => {
    expect(layout(11, 200, true).showGuide).toBe(false);
    expect(layout(12, 200, true).showGuide).toBe(true);
  });

  it("hides the guide when toggled off", () => {
    const l = layout(40, 200, false);
    expect(l.showGuide).toBe(false);
  });

  it("hides the info strip + footer on short terminals but keeps the input pinned", () => {
    const l = layout(MIN_CHROME_ROWS - 1, 200, true); // 13 rows
    expect(l.showBanner).toBe(true);
    expect(l.showInfo).toBe(false);
    expect(l.viewportRows).toBe(13 - 5 - 1); // 7
    expect(l.inputRow).toBe(13); // footer hidden → input on the bottom row
  });

  it("collapses the center viewport rather than overflow the input on tiny windows", () => {
    // The input line must survive window resizes: chrome rows are pinned, so the
    // center viewport may shrink to 0 instead of pushing the input off-screen.
    expect(layout(6, 40, true).viewportRows).toBe(0); // banner 5 + input 1 = rows
    expect(layout(6, 40, true).inputRow).toBe(6);
    expect(layout(5, 40, true).viewportRows).toBe(4); // banner hidden
    expect(layout(5, 40, true).inputRow).toBe(5);
    expect(layout(1, 40, true).viewportRows).toBe(0);
    expect(layout(1, 40, true).inputRow).toBe(1);
  });

  it("computes viewportTop as 1 plus the chrome rows above the results region", () => {
    expect(layout(40, 160, true).viewportTop).toBe(7); // 1 + banner 5 + info 1
    expect(layout(11, 200, true).viewportTop).toBe(6); // info hidden below MIN_CHROME_ROWS
    expect(layout(5, 40, true).viewportTop).toBe(1); // banner hidden too
  });

  it("computes resultWidth as cols minus guide width minus 2 margin columns", () => {
    expect(layout(40, 160, true).resultWidth).toBe(110); // 160 - guide 48 - 2
    expect(layout(60, 200, true).resultWidth).toBe(150); // guide capped at 48
    expect(layout(60, MIN_GUIDE_COLUMNS - 1, true).resultWidth).toBe(102); // guide hidden → 0
    expect(layout(40, 200, false).resultWidth).toBe(198); // guide toggled off
    expect(layout(1, 40, true).resultWidth).toBe(38); // narrow, guide hidden
  });
});

describe("TUI guide content", () => {
  it("builds sections from the command registry and engine facts", () => {
    const sections = guideSections({ version: "0.3.0", commands: ["balance", "element"], elementCount: 118 });
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual(["Commands", "Keys", "Engine"]);
    const commands = sections[0]!.lines.join("\n");
    expect(commands).toContain("balance");
    expect(commands).toContain("element");
    const keys = sections[1]!.lines.join("\n");
    expect(keys).toContain("^G show/hide this guide");
    expect(keys).toContain("PgUp/Dn · wheel scroll");
    const engine = sections[2]!.lines.join("\n");
    expect(engine).toContain("118 elements embedded");
    expect(engine).toContain("v0.3.0");
  });

  it("keeps every guide line within the narrowest panel inner width", () => {
    // guideWidth floors at 30 → inner = 30 − border 2 − paddingX 2 = 26 cols.
    const sections = guideSections({ version: "0.3.0", commands: ["balance", "element"], elementCount: 118 });
    for (const s of sections) {
      for (const line of s.lines) expect(line.length).toBeLessThanOrEqual(26);
    }
  });
});

describe("TUI render options", () => {
  it("uses the alternate screen buffer + incremental rendering so frames never scroll the normal buffer or blink", () => {
    // alternateScreen: Ink 7 clears + redraws viewport-filling frames into the
    // normal buffer (issue #969 workaround) which on Windows brings up a
    // right-hand scrollbar and desyncs the input line.
    // incrementalRendering: without it Ink's standard renderer erases and
    // rewrites the ENTIRE frame on every keystroke (the blink). Both layers
    // are pinned here so a revert of either fails loudly.
    expect(TUI_RENDER_OPTIONS).toEqual({ exitOnCtrlC: false, alternateScreen: true, incrementalRendering: true });
  });
});

describe("TUI persistence", () => {
  const dir = mkdtempSync(join(tmpdir(), "chemengine-test-"));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns defaults when no config exists", () => {
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    expect(loadHistory(dir)).toEqual([]);
  });

  it("round-trips config", () => {
    saveConfig({ resultLimit: 4, bannerOn: false, guideOn: false }, dir);
    expect(loadConfig(dir)).toEqual({ resultLimit: 4, bannerOn: false, guideOn: false });
  });

  it("caps history and persists it", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `cmd${i}`);
    saveHistory(lines, dir);
    const loaded = loadHistory(dir);
    expect(loaded).toHaveLength(500);
    expect(loaded[0]).toBe("cmd100");
    expect(loaded.at(-1)).toBe("cmd599");
    const onDisk = JSON.parse(readFileSync(historyPath(dir), "utf8")) as string[];
    expect(onDisk).toHaveLength(500);
  });

  it("silently tolerates corrupt files", () => {
    const badDir = mkdtempSync(join(tmpdir(), "chemengine-bad-"));
    try {
      saveConfig({ resultLimit: 1, bannerOn: true, guideOn: true }, badDir);
      // Sabotage the config file so JSON.parse throws.
      writeFileSync(join(badDir, "config.json"), "{not json");
      expect(loadConfig(badDir)).toEqual(DEFAULT_CONFIG);
      expect(loadHistory(badDir)).toEqual([]);
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
  });
});