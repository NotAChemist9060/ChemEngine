/**
 * Render-level tests for the drag-selection highlight in ResultPane.
 *
 * Ink's `renderToString` routes styles through chalk, which strips ANSI when it
 * sees no TTY — so this file sets FORCE_COLOR=1 BEFORE ink/chalk is first
 * imported. Static imports can't do that (ESM hoists them above any statement),
 * hence the lazy dynamic loader below; the static-import render files
 * (tui-render, screen-lines) intentionally keep the color-stripped output.
 *
 * Ink also trims trailing whitespace on every rendered line (output.js
 * `.trimEnd()`), so blank/gap rows render as empty strings — card rows keep
 * full width because they end in a border glyph. Assertions compare only the
 * cells Ink actually emitted, mapping rendered col c+1 (col 0 = the pane's
 * paddingX) to the screen-model's col c.
 */
process.env.FORCE_COLOR = "1";

import { describe, expect, it } from "vitest";
import type { ResultEntry } from "../src/tui/state.ts";
import type { PaneLine } from "../src/tui/scroll.ts";
import type { Selection } from "../src/tui/select.ts";

const OK: ResultEntry = { id: 1, command: "a", output: "hello", ok: true };
const BAD: ResultEntry = { id: 2, command: "b", output: "error!", ok: false };
const TWO = [OK, BAD] satisfies readonly ResultEntry[];

async function initModules() {
  const ink = await import("ink");
  const react = await import("react");
  const { ResultPane } = await import("../src/tui/resultpane.ts");
  const { buildScreenLines } = await import("../src/tui/scroll.ts");
  const sel = await import("../src/tui/select.ts");
  const { box } = await import("../src/tui/el.ts");
  return {
    renderToString: ink.renderToString,
    createElement: react.createElement,
    ResultPane,
    buildScreenLines,
    box,
    startSelection: sel.startSelection,
    extendSelection: sel.extendSelection,
    selectionCell: sel.selectionCell,
  };
}

type LoadedModules = Awaited<ReturnType<typeof initModules>>;

let loaded: Promise<LoadedModules> | undefined;

/** Lazy import so chalk initializes with FORCE_COLOR=1 (see header note). */
function load(): Promise<LoadedModules> {
  if (!loaded) loaded = initModules();
  return loaded;
}

interface CellState {
  inverse: boolean;
  dim: boolean;
  color: number | null;
}

/** Walk a rendered line's SGR codes; one entry per visible char (styles snapshot). */
function analyzeLine(line: string): Array<{ ch: string; st: CellState }> {
  const re = /\x1b\[([0-9;]*)m/g;
  const cells: Array<{ ch: string; st: CellState }> = [];
  let st: CellState = { inverse: false, dim: false, color: null };
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    for (const ch of line.slice(last, m.index)) cells.push({ ch, st });
    for (const code of m[1]!.split(";").map((s) => Number(s))) {
      if (code === 7) st = { ...st, inverse: true };
      else if (code === 27) st = { ...st, inverse: false };
      else if (code === 2) st = { ...st, dim: true };
      else if (code === 22) st = { ...st, dim: false };
      else if (code === 39) st = { ...st, color: null };
      else if (code >= 30 && code <= 37) st = { ...st, color: code };
      else if (code >= 90 && code <= 97) st = { ...st, color: code };
    }
    last = m.index + m[0].length;
  }
  for (const ch of line.slice(last)) cells.push({ ch, st });
  return cells;
}

/**
 * Render ResultPane with a selection exactly as the app frames it (width+2
 * column, fixed viewport height, overflow clipped) and return both the
 * rendered rows and the screen-model lines for comparison.
 */
async function renderSelectionPane(
  results: readonly ResultEntry[],
  scrollTop: number | null,
  viewportRows: number,
  width: number,
  selection: Selection,
): Promise<{ rendered: string[]; lines: PaneLine[] }> {
  const { renderToString, createElement, ResultPane, buildScreenLines, box } = await load();
  const node = box(
    { flexDirection: "column", height: viewportRows, overflowY: "hidden" },
    box(
      { width: width + 2, flexDirection: "column", overflowY: "hidden" },
      createElement(ResultPane, { results, scrollTop, viewportRows, width, selection }),
    ),
  );
  const rendered = renderToString(node, { columns: 200 }).split("\n");
  return { rendered, lines: buildScreenLines(results, scrollTop, viewportRows, width) };
}

/** Every rendered cell that exists must show exactly the selectionCell verdict. */
function assertInverseMatches(
  rendered: string[],
  lines: PaneLine[],
  sel: Selection,
  selectionCell: (sel: Selection, row: number, col: number) => boolean,
): void {
  expect(rendered).toHaveLength(lines.length);
  for (let r = 0; r < lines.length; r++) {
    const text = lines[r]!.text;
    const cells = analyzeLine(rendered[r] ?? "");
    for (let c = 0; c < text.length; c++) {
      const cell = cells[c + 1]; // col 0 is the pane's paddingX → line col c at c+1
      if (cell === undefined) break; // blanks are trimmed entirely
      expect(cell.st.inverse, `row ${r} col ${c} inverse`).toBe(selectionCell(sel, r, c));
    }
  }
}

describe("ResultPane selection highlight", () => {
  it("inverts exactly the selection box cells (normal and reversed drags)", async () => {
    const { startSelection, extendSelection, selectionCell } = await load();
    // Single card at width 10 → rows 0-5, cols 0-9. Box rows 1-4 × cols 2-9.
    const selectors: Selection[] = [
      extendSelection(startSelection(1, 2), 4, 9),
      extendSelection(startSelection(4, 9), 1, 2), // anchor below/right of active
    ];
    for (const sel of selectors) {
      const { rendered, lines } = await renderSelectionPane([OK], 0, 10, 10, sel);
      assertInverseMatches(rendered, lines, sel, selectionCell);
      // Green card rows carry the border color on every emitted cell.
      for (let r = 0; r < 6; r++) {
        const cells = analyzeLine(rendered[r] ?? "");
        expect(cells.length, `row ${r} keeps its border glyph`).toBeGreaterThan(0);
        expect(cells.some((c) => c.st.color === 32), `row ${r} border green`).toBe(true);
      }
    }
  });

  it("keeps dim header rows dim outside the selection and readable (inverse, no dim/color) inside it", async () => {
    const { startSelection, extendSelection, selectionCell } = await load();
    const sel = extendSelection(startSelection(2, 4), 2, 7); // header row 2, cols 4-7
    const { rendered, lines } = await renderSelectionPane([OK], 0, 10, 10, sel);
    const header = analyzeLine(rendered[2] ?? "");
    for (let c = 0; c < lines[2]!.text.length; c++) {
      const cell = header[c + 1];
      if (cell === undefined) break;
      const selected = selectionCell(sel, 2, c);
      const isBorderGlyph = c === 0 || c === 9;
      if (selected) {
        expect(cell.st.inverse, `header col ${c} inverse`).toBe(true);
        expect(cell.st.dim, `header col ${c} no dim`).toBe(false);
        expect(cell.st.color, `header col ${c} flat highlight`).toBeNull();
      } else if (isBorderGlyph) {
        expect(cell.st.inverse, `border col ${c}`).toBe(false);
        expect(cell.st.color, `border col ${c} green`).toBe(32);
        expect(cell.st.dim, `border col ${c} never dim`).toBe(false);
      } else {
        expect(cell.st.inverse, `content col ${c}`).toBe(false);
        expect(cell.st.dim, `content col ${c} stays dim`).toBe(true);
        expect(cell.st.color, `content col ${c} default fg`).toBeNull();
      }
    }
    // No other row shows any inverse.
    for (const r of [0, 1, 3, 4, 5]) {
      expect(analyzeLine(rendered[r] ?? "").some((c) => c.st.inverse), `row ${r} untouched`).toBe(false);
    }
  });

  it("spans two cards and the inter-card gap as one coherent box", async () => {
    const { startSelection, extendSelection, selectionCell } = await load();
    // TWO at width 10 → card1 rows 0-5, gap row 6, card2 rows 7-12, blank 13.
    // Select interior cols 2-7 so each card keeps visible border glyphs (green
    // on card1, red on card2) beside the highlighted run.
    const sel = extendSelection(startSelection(0, 2), 12, 7);
    const { rendered, lines } = await renderSelectionPane(TWO, 0, 14, 10, sel);
    assertInverseMatches(rendered, lines, sel, selectionCell);
    for (const r of [0, 1, 2, 3, 4, 5]) {
      expect(analyzeLine(rendered[r] ?? "").some((c) => c.st.color === 32), `card1 row ${r} green`).toBe(true);
    }
    for (const r of [7, 8, 9, 10, 11, 12]) {
      expect(analyzeLine(rendered[r] ?? "").some((c) => c.st.color === 31), `card2 row ${r} red`).toBe(true);
    }
    // The gap row (6) is blank: nothing renders, and it carries no color.
    expect(analyzeLine(rendered[6] ?? "").some((c) => c.st.color !== null), "gap row has no color").toBe(false);
  });

  it("keeps the scrolled-off marker dim and unselected while cards highlight from row 2", async () => {
    const { startSelection, extendSelection, selectionCell } = await load();
    // TWO at width 40 → heights [7, 6]; viewport 10 with scrollTop 5 → marker at
    // row 0, cards from row 2 (screen-lines geometry, pre-verified in tests).
    const sel = extendSelection(startSelection(2, 1), 8, 20);
    const { rendered, lines } = await renderSelectionPane(TWO, 5, 10, 40, sel);
    assertInverseMatches(rendered, lines, sel, selectionCell);
    const marker = analyzeLine(rendered[0] ?? "");
    expect(marker.some((c) => c.st.dim), "marker row stays dim").toBe(true);
    expect(marker.some((c) => c.st.inverse), "marker row is never selected").toBe(false);
    expect(marker.some((c) => c.st.color !== null), "marker row has no border color").toBe(false);
  });
});