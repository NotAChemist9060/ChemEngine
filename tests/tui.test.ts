import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState, reducer, DEFAULT_CONFIG } from "../src/tui/state.ts";
import { keyToAction, type PressedKey } from "../src/tui/keymap.ts";
import { candidatesFor, commandNames, lastToken } from "../src/tui/completions.ts";
import { filterPalette, paletteItems } from "../src/tui/palette-list.ts";
import { historyPath, loadConfig, loadHistory, saveConfig, saveHistory } from "../src/tui/persist.ts";
import { layout, MIN_CHROME_ROWS, MIN_GUIDE_COLUMNS } from "../src/tui/layout.ts";
import { guideSections } from "../src/tui/guide.ts";

function press(p: PressedKey, input = ""): { input: string; key: PressedKey } {
  return { input, key: p };
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

  it("scrolling clamps to the scroll page", () => {
    const s0 = initialState(DEFAULT_CONFIG, []);
    let s = s0;
    for (let i = 0; i < 12; i++) {
      s = reducer(s, { type: "submit", command: `cmd${i}`, output: `out${i}`, ok: true });
    }
    // 12 results, page 8 → 4 extra available above the window.
    s = reducer(s, { type: "scroll-up", page: 8 });
    expect(s.scrollOffset).toBe(1);
    for (let i = 0; i < 10; i++) s = reducer(s, { type: "scroll-up", page: 8 });
    expect(s.scrollOffset).toBe(4);
    s = reducer(s, { type: "scroll-up", page: 8 });
    expect(s.scrollOffset).toBe(4); // clamped
    s = reducer(s, { type: "scroll-down" });
    expect(s.scrollOffset).toBe(3);
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
});

describe("TUI completions", () => {
  it("exposes command names", () => {
    expect(commandNames()).toContain("balance");
    expect(commandNames()).toContain("element");
  });

  it("finds the last token", () => {
    expect(lastToken("balance CH4 + O")).toBe("O");
    expect(lastToken("" )).toBe("");
  });

  it("completes the first word with commands", () => {
    expect(candidatesFor("")).toContain("balance");
    expect(candidatesFor("bal")).toEqual(expect.arrayContaining(["balance"]));
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

  it("filters by substring", () => {
    expect(filterPalette(paletteItems(), "bal").map((i) => i.name)).toContain("balance");
    expect(filterPalette(paletteItems(), "zzz")).toHaveLength(0);
    expect(filterPalette(paletteItems(), "")).toHaveLength(paletteItems().length);
  });
});

describe("TUI layout math", () => {
  it("shows all chrome on a large terminal", () => {
    const l = layout(40, 160, true, 8);
    expect(l.showBanner).toBe(true);
    expect(l.showInfo).toBe(true);
    expect(l.showGuide).toBe(true);
    expect(l.guideWidth).toBeGreaterThanOrEqual(30);
    expect(l.pageSize).toBeGreaterThanOrEqual(4);
  });

  it("hides the guide on narrow terminals", () => {
    const l = layout(40, MIN_GUIDE_COLUMNS - 1, true, 8);
    expect(l.showGuide).toBe(false);
    expect(l.guideWidth).toBe(0);
  });

  it("hides the guide when toggled off", () => {
    const l = layout(40, 200, false, 8);
    expect(l.showGuide).toBe(false);
  });

  it("hides the info strip + footer on short terminals but keeps a scroll page", () => {
    const l = layout(MIN_CHROME_ROWS - 1, 200, true, 8);
    expect(l.showBanner).toBe(true);
    expect(l.showInfo).toBe(false);
    expect(l.pageSize).toBeGreaterThanOrEqual(1);
  });

  it("keeps a minimum page size even on tiny terminals", () => {
    const l = layout(5, 40, true, 8);
    expect(l.pageSize).toBe(1);
  });

  it("caps the page size at the configured result limit", () => {
    const l = layout(60, 200, true, 3);
    expect(l.pageSize).toBeLessThanOrEqual(3);
  });
});

describe("TUI guide content", () => {
  it("builds sections from the command registry and engine facts", () => {
    const sections = guideSections({ version: "0.2.0", commands: ["balance", "element"], elementCount: 118 });
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual(["Commands", "Keys", "Engine"]);
    const commands = sections[0]!.lines.join("\n");
    expect(commands).toContain("balance");
    expect(commands).toContain("element");
    const keys = sections[1]!.lines.join("\n");
    expect(keys).toContain("^G show/hide this guide");
    const engine = sections[2]!.lines.join("\n");
    expect(engine).toContain("118 elements embedded");
    expect(engine).toContain("v0.2.0");
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