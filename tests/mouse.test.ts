import { describe, expect, it } from "vitest";
import {
  classifyMouse,
  colToCursorIndex,
  createMouseParser,
  isMouseSequence,
  parseSgr,
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
  const ctx = { active: true, inputRow: 10, inputLength: 5 };
  const wheel = (dir: 1 | -1): SgrMouseEvent => ({ kind: "wheel", button: dir === 1 ? 64 : 65, col: 1, row: 1, wheelDir: dir });

  it("maps wheel events to scroll intents", () => {
    expect(classifyMouse(wheel(1), ctx)).toEqual({ kind: "scroll", dir: 1 });
    expect(classifyMouse(wheel(-1), ctx)).toEqual({ kind: "scroll", dir: -1 });
  });

  it("maps a left-button press on the input row to a clamped cursor index", () => {
    const press: SgrMouseEvent = { kind: "press", button: 0, col: 9, row: 10 };
    expect(classifyMouse(press, ctx)).toEqual({ kind: "set-cursor", index: 1 }); // 9 - 1 - 7
  });

  it("ignores clicks off the input row, non-left buttons, and releases", () => {
    const offRow: SgrMouseEvent = { kind: "press", button: 0, col: 9, row: 5 };
    expect(classifyMouse(offRow, ctx)).toBeNull();
    const middle: SgrMouseEvent = { kind: "press", button: 1, col: 9, row: 10 };
    expect(classifyMouse(middle, ctx)).toBeNull();
    const right: SgrMouseEvent = { kind: "press", button: 2, col: 9, row: 10 };
    expect(classifyMouse(right, ctx)).toBeNull();
    const release: SgrMouseEvent = { kind: "release", button: 0, col: 9, row: 10 };
    expect(classifyMouse(release, ctx)).toBeNull();
  });

  it("ignores everything while inactive (e.g. palette open)", () => {
    const inactive = { ...ctx, active: false };
    expect(classifyMouse(wheel(1), inactive)).toBeNull();
    const press: SgrMouseEvent = { kind: "press", button: 0, col: 9, row: 10 };
    expect(classifyMouse(press, inactive)).toBeNull();
  });

  it("maps terminal columns to cursor indices through the prompt offset", () => {
    // 1-based col, promptOffset 7 = paddingX 1 + "chem> " (6) → col 8 = index 0.
    expect(colToCursorIndex(8, 5)).toBe(0);
    expect(colToCursorIndex(12, 5)).toBe(4);
    expect(colToCursorIndex(20, 5)).toBe(5); // clamped to input length
    expect(colToCursorIndex(1, 5)).toBe(0);
  });
});