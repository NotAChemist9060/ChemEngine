import { describe, expect, it } from "vitest";
import { buildScreenLines } from "../src/tui/scroll.ts";
import type { PaneLine } from "../src/tui/scroll.ts";
import {
  extendSelection,
  extractSelectionText,
  hasArea,
  normalizedBox,
  selectionCell,
  startSelection,
  type Selection,
  type SelectionBox,
} from "../src/tui/select.ts";
import type { ResultEntry } from "../src/tui/state.ts";

/** Short commands → every card is exactly 7 rows at width 10 (chrome 4 + 1 header + 2 body). */
const OK = { id: 1, command: "a", output: "a\nb", ok: true } satisfies ResultEntry;
const BAD = { id: 2, command: "b", output: "err", ok: false } satisfies ResultEntry;

/** A width-10 card row. Content spans cols 2–7; padding to col 8; border at col 9. */
function cardRow(text: string, extra: { dim?: boolean; border?: "green" | "red" } = {}): PaneLine {
  return {
    row: 0,
    text,
    card: true,
    ...(extra.dim ? { dim: true } : {}),
    ...(extra.border ? { border: extra.border } : {}),
  };
}

/** A non-card row (gap / marker / bottom fill). */
function blankRow(text = " ".repeat(10)): PaneLine {
  return { row: 0, text, card: false };
}

/** Re-stamp the `row` field to match array order (viewport-local indexing). */
function numbered(rows: PaneLine[]): PaneLine[] {
  return rows.map((r, i) => ({ ...r, row: i }));
}

/** One short green card exactly as `buildScreenLines` emits it at width 10. */
function singleCard(): PaneLine[] {
  return numbered([
    cardRow("╭────────╮", { border: "green" }),
    cardRow("│        │"),
    cardRow("│ #1 $ a │", { dim: true }),
    cardRow("│ a      │"),
    cardRow("│ b      │"),
    cardRow("│        │"),
    cardRow("╰────────╯", { border: "green" }),
  ]);
}

describe("startSelection / extendSelection", () => {
  it("pins anchor = active on start", () => {
    expect(startSelection(3, 4)).toEqual({ anchorRow: 3, anchorCol: 4, activeRow: 3, activeCol: 4 });
  });

  it("moves only the active corner and never mutates the source", () => {
    const sel = startSelection(3, 4);
    expect(extendSelection(sel, 5, 2)).toEqual({ anchorRow: 3, anchorCol: 4, activeRow: 5, activeCol: 2 });
    expect(sel).toEqual({ anchorRow: 3, anchorCol: 4, activeRow: 3, activeCol: 4 });
  });
});

describe("normalizedBox", () => {
  it("normalizes all four anchor/active quadrants to the same inclusive box", () => {
    const expected: SelectionBox = { top: 2, left: 5, bottom: 5, right: 8 };
    const cases: Selection[] = [
      { anchorRow: 5, anchorCol: 5, activeRow: 2, activeCol: 8 },
      { anchorRow: 5, anchorCol: 8, activeRow: 2, activeCol: 5 },
      { anchorRow: 2, anchorCol: 5, activeRow: 5, activeCol: 8 },
      { anchorRow: 2, anchorCol: 8, activeRow: 5, activeCol: 5 },
    ];
    for (const sel of cases) expect(normalizedBox(sel)).toEqual(expected);
  });
});

describe("selectionCell", () => {
  it("is inclusive on all four edges of the box", () => {
    const sel = extendSelection(startSelection(2, 5), 5, 8);
    for (const [row, col] of [[2, 5], [2, 8], [5, 5], [5, 8], [3, 7]] as const) {
      expect(selectionCell(sel, row, col)).toBe(true);
    }
    for (const [row, col] of [[1, 7], [6, 7], [3, 4], [3, 9]] as const) {
      expect(selectionCell(sel, row, col)).toBe(false);
    }
  });
});

describe("hasArea", () => {
  it("is false when anchor equals active, true when either axis differs", () => {
    const sel = startSelection(3, 4);
    expect(hasArea(sel)).toBe(false);
    expect(hasArea(extendSelection(sel, 3, 9))).toBe(true); // col only
    expect(hasArea(extendSelection(sel, 7, 4))).toBe(true); // row only
    expect(hasArea(extendSelection(sel, 3, 4))).toBe(false);
  });
});

describe("extractSelectionText", () => {
  it("slices one row and right-trims interior padding", () => {
    const lines = singleCard();
    // cols [2,7] = the body "a" plus its padding, trailing spaces trimmed
    expect(extractSelectionText(lines, extendSelection(startSelection(3, 2), 3, 7))).toBe("a");
  });

  it("joins card rows with newlines, right-trimming each", () => {
    const lines = singleCard();
    expect(extractSelectionText(lines, extendSelection(startSelection(3, 2), 4, 7))).toBe("a\nb");
  });

  it("keeps the border glyph when the box ends on it (what-you-select)", () => {
    const lines = singleCard();
    // col 8 = the trailing padding → trimmed; col 9 = the │ border → kept
    expect(extractSelectionText(lines, extendSelection(startSelection(3, 2), 3, 8))).toBe("a");
    expect(extractSelectionText(lines, extendSelection(startSelection(3, 2), 3, 9))).toBe("a      │");
  });

  it("preserves a blank separator when a drag spans two cards", () => {
    const lines = buildScreenLines([OK, BAD], 0, 20, 10); // card1 0–6, gap 7, card2 8–13, fill 14–19
    expect(extractSelectionText(lines, extendSelection(startSelection(4, 2), 7, 8))).toBe("b\n\n───────");
    expect(extractSelectionText(lines, extendSelection(startSelection(3, 2), 11, 8))).toBe(
      "a\nb\n\n───────\n\n───────\n\n#2 $ b\nerr",
    );
  });

  it("excludes a non-blank marker row entirely but keeps leading gap blanks", () => {
    const lines = numbered([
      { row: 0, text: "▲ 3 rows above", card: false, dim: true },
      blankRow(), // gap after the marker
      cardRow("│ #1 $ a │", { dim: true }),
      cardRow("│ a      │"),
      blankRow(), // bottom fill
    ]);
    const text = extractSelectionText(lines, extendSelection(startSelection(0, 0), 4, 9));
    expect(text).toBe("\n│ #1 $ a │\n│ a      │");
    expect(text).not.toContain("▲");
  });

  it("drops trailing blank rows (bottom fill) from the copy", () => {
    const lines = numbered([cardRow("│ a      │"), cardRow("│ b      │"), blankRow(), blankRow()]);
    expect(extractSelectionText(lines, extendSelection(startSelection(0, 2), 3, 7))).toBe("a\nb");
  });

  it("returns an empty string for a blank-only selection", () => {
    const lines = numbered([blankRow(), blankRow()]);
    expect(extractSelectionText(lines, startSelection(0, 0))).toBe("");
    expect(extractSelectionText(lines, extendSelection(startSelection(0, 0), 1, 5))).toBe("");
  });

  it("is safe when the box extends past the viewport rows", () => {
    const lines = numbered([cardRow("│ a      │"), cardRow("│ b      │")]);
    expect(extractSelectionText(lines, extendSelection(startSelection(0, 2), 5, 7))).toBe("a\nb");
  });

  it("copies border glyphs for a full-width box (cols 0–9)", () => {
    const lines = numbered([cardRow("│ a      │"), cardRow("╰────────╯", { border: "green" })]);
    expect(extractSelectionText(lines, extendSelection(startSelection(0, 0), 0, 9))).toBe("│ a      │");
    expect(extractSelectionText(lines, extendSelection(startSelection(0, 0), 1, 9))).toBe("│ a      │\n╰────────╯");
  });
});