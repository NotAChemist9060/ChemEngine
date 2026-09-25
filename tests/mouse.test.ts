import { describe, expect, it } from "vitest";
import {
  classifyMouse,
  colToCursorIndex,
  createMouseParser,
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  isMouseSequence,
  parseSgr,
  type MouseContext,
  type SgrMouseEvent,
} from "../src/tui/mouse.ts";

describe("TUI mouse SGR parsing", () => {
  it("parses wheel press events (buttons 64/65)", () => {
    expect(parseSgr("\u001b[<64;5;8M")).toEqual({
      kind: "wheel",
      button: 64,
      col: 5,
      row: 8,
      wheelDir: 1,
    });
    expect(parseSgr("\u001b[<65;12;3M")).toEqual({
      kind: "wheel",
      button: 65,
      col: 12,
      row: 3,
      wheelDir: -1,
    });
  });

  it("parses button press and release (final M vs m)", () => {
    expect(parseSgr("\u001b[<0;10;5M")).toEqual({ kind: "press", button: 0, col: 10, row: 5 });
    expect(parseSgr("\u001b[<0;10;5m")).toEqual({ kind: "release", button: 0, col: 10, row: 5 });
    expect(parseSgr("\u001b[<2;4;4M")).toEqual({ kind: "press", button: 2, col: 4, row: 4 });
  });

  it("parses motion reports (button bit 0x20) with the held button preserved", () => {
    expect(parseSgr("\u001b[<32;5;8M")).toEqual({ kind: "motion", button: 32, col: 5, row: 8, heldButton: 0 });
    expect(parseSgr("\u001b[<34;5;8M")).toEqual({ kind: "motion", button: 34, col: 5, row: 8, heldButton: 2 });
    expect(parseSgr("\u001b[<36;5;8M")).toEqual({ kind: "motion", button: 36, col: 5, row: 8, heldButton: 4 });
  });

  it("parses a drag release (motion-style code with final m) as a release", () => {
    expect(parseSgr("\u001b[<32;5;8m")).toEqual({ kind: "release", button: 32, col: 5, row: 8 });
  });

  it("enables SGR + press/wheel + drag-motion reporting, and disables them on unmount", () => {
    expect(ENABLE_MOUSE).toBe("\u001b[?1006h\u001b[?1000h\u001b[?1002h");
    expect(DISABLE_MOUSE).toBe("\u001b[?1006l\u001b[?1000l\u001b[?1002l");
  });

  it("returns null for non-mouse input", () => {
    expect(parseSgr("hello")).toBeNull();
    expect(parseSgr("\u001b[A")).toBeNull(); // arrow key
    expect(parseSgr("")).toBeNull();
  });

  it("reassembles SGR sequences split across stdin chunks", () => {
    const parser = createMouseParser();
    expect(parser.push("\u001b[<6")).toEqual([]); // partial — held
    expect(parser.push("4;1;1M")).toEqual([
      { kind: "wheel", button: 64, col: 1, row: 1, wheelDir: 1 },
    ]);
    expect(parser.push("\u001b[<65;2;2")).toEqual([]);
    expect(parser.push("M")).toEqual([
      { kind: "wheel", button: 65, col: 2, row: 2, wheelDir: -1 },
    ]);
    expect(parser.push("\u001b[<32;3;3")).toEqual([]);
    expect(parser.push("M")).toEqual([
      { kind: "motion", button: 32, col: 3, row: 3, heldButton: 0 },
    ]);
  });

  it("handles multiple events in one chunk and drops non-mouse bytes", () => {
    const parser = createMouseParser();
    const events = parser.push("\u001b[<64;1;1M\u001b[<65;2;2M");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ button: 64 });
    expect(events[1]).toMatchObject({ button: 65 });

    const noisy = createMouseParser();
    expect(noisy.push("junk\u001b[<0;3;3M more")).toEqual([
      { kind: "press", button: 0, col: 3, row: 3 },
    ]);
  });

  it("tolerates a lone ESC byte without hanging", () => {
    const parser = createMouseParser();
    expect(parser.push("\u001b")).toEqual([]);
    expect(parser.push("\u001b[<0;1;1m")).toEqual([{ kind: "release", button: 0, col: 1, row: 1 }]);
  });

  it("recognizes mouse reports by prefix", () => {
    expect(isMouseSequence("\u001b[<0;1;1M")).toBe(true);
    expect(isMouseSequence("\u001b[A")).toBe(false);
    expect(isMouseSequence("x")).toBe(false);
  });
});

describe("TUI mouse intent mapping", () => {
  const ctx = (over: Partial<MouseContext> = {}): MouseContext => ({
    active: true,
    inputRow: 10,
    inputLength: 5,
    viewportTop: 3, // results rows are terminal rows 3..8
    viewportRows: 6, // local rows 0..5
    resultLeft: 2, // card left border = terminal col 2
    resultWidth: 10, // local cols 0..9
    selectionActive: false,
    ...over,
  });
  const wheel = (dir: 1 | -1): SgrMouseEvent => ({ kind: "wheel", button: dir === 1 ? 64 : 65, col: 1, row: 1, wheelDir: dir });
  const press = (button: number, col: number, row: number): SgrMouseEvent => ({ kind: "press", button, col, row });
  const release = (button: number, col: number, row: number): SgrMouseEvent => ({ kind: "release", button, col, row });
  const motion = (button: number, col: number, row: number): SgrMouseEvent => ({ kind: "motion", button, col, row, heldButton: button & 0x1f });

  it("maps wheel events to scroll intents", () => {
    expect(classifyMouse(wheel(1), ctx())).toEqual({ kind: "scroll", dir: 1 });
    expect(classifyMouse(wheel(-1), ctx())).toEqual({ kind: "scroll", dir: -1 });
  });

  it("maps a left-button press on the input row to a clamped cursor index", () => {
    expect(classifyMouse(press(0, 9, 10), ctx())).toEqual({ kind: "set-cursor", index: 1 }); // 9 - 1 - 7
  });

  it("starts a selection for left presses in the results region (clamped)", () => {
    expect(classifyMouse(press(0, 9, 5), ctx())).toEqual({ kind: "select-start", row: 2, col: 7 });
  });

  it("ignores non-left presses, releases without a selection, and wheel releases", () => {
    expect(classifyMouse(press(1, 9, 10), ctx())).toBeNull(); // middle
    expect(classifyMouse(press(2, 9, 10), ctx())).toBeNull(); // right
    expect(classifyMouse(press(4, 9, 5), ctx())).toBeNull(); // Shift+click stays native
    expect(classifyMouse(release(0, 9, 10), ctx())).toBeNull(); // no active selection
    expect(classifyMouse(release(64, 9, 10), ctx({ selectionActive: true }))).toBeNull(); // wheel release
  });

  it("extends the selection on left-button motion, clamped to the region", () => {
    expect(classifyMouse(motion(32, 30, 7), ctx({ selectionActive: true }))).toEqual({
      kind: "select-extend",
      row: 4,
      col: 9,
    });
  });

  it("ignores motion while no selection is active (a drag up from the input row)", () => {
    expect(classifyMouse(motion(32, 9, 5), ctx())).toBeNull();
  });

  it("ignores non-left drags (right or shift+drag stay native)", () => {
    expect(classifyMouse(motion(34, 9, 5), ctx({ selectionActive: true }))).toBeNull(); // right drag
    expect(classifyMouse(motion(36, 9, 5), ctx({ selectionActive: true }))).toBeNull(); // shift+left drag
  });

  it("finishes the selection on left release while a drag is active", () => {
    expect(classifyMouse(release(0, 9, 10), ctx({ selectionActive: true }))).toEqual({ kind: "select-finish" });
    expect(classifyMouse(release(32, 9, 10), ctx({ selectionActive: true }))).toEqual({ kind: "select-finish" });
  });

  it("clamps presses above the region to row 0 and past the right edge to the last column", () => {
    expect(classifyMouse(press(0, 1, 1), ctx())).toEqual({ kind: "select-start", row: 0, col: 0 });
    expect(classifyMouse(press(0, 100, 100), ctx())).toEqual({ kind: "select-start", row: 5, col: 9 });
  });

  it("returns null for a collapsed results region (no rows / no width)", () => {
    expect(classifyMouse(press(0, 5, 5), ctx({ viewportRows: 0 }))).toBeNull();
    expect(classifyMouse(press(0, 5, 5), ctx({ resultWidth: 0 }))).toBeNull();
  });

  it("ignores everything while inactive (e.g. palette open)", () => {
    const inactive = ctx({ active: false });
    expect(classifyMouse(wheel(1), inactive)).toBeNull();
    expect(classifyMouse(press(0, 9, 10), inactive)).toBeNull();
    expect(classifyMouse(motion(32, 9, 5), ctx({ active: false, selectionActive: true }))).toBeNull();
  });

  it("maps terminal columns to cursor indices through the prompt offset", () => {
    // 1-based col, promptOffset 7 = paddingX 1 + "chem> " (6) → col 8 = index 0.
    expect(colToCursorIndex(8, 5)).toBe(0);
    expect(colToCursorIndex(12, 5)).toBe(4);
    expect(colToCursorIndex(20, 5)).toBe(5); // clamped to input length
    expect(colToCursorIndex(1, 5)).toBe(0);
  });
});