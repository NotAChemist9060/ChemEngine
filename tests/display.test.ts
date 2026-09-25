import { describe, expect, it } from "vitest";
import {
  displayWidth,
  makeDisplayLine,
  sliceDisplayLine,
  truncateDisplayLine,
} from "../src/tui/display.ts";
import { extendSelection, extractSelectionText, startSelection } from "../src/tui/select.ts";
import { buildScreenLines } from "../src/tui/scroll.ts";
import type { ResultEntry } from "../src/tui/state.ts";

const STYLED = "\x1b[1;32mred\x1b[0m";

describe("display-cell normalization", () => {
  it("removes ANSI controls while retaining visible SGR state", () => {
    const line = makeDisplayLine(`${STYLED} plain`, 16);

    expect(line.text).toBe("red plain       ");
    expect(line.text).not.toContain("\x1b");
    expect(displayWidth(line.text)).toBe(16);
    expect(line.cells[0]).toMatchObject({ value: "r", width: 1, column: 0, style: { bold: true, color: "green" } });
    expect(line.cells.find((cell) => cell.value === "p")?.style).toEqual({});
    expect(sliceDisplayLine(line, 0, 2)).toBe("red");
  });

  it("keeps wide graphemes and combining clusters indivisible", () => {
    const line = makeDisplayLine("界e\u0301x", 8);
    const wide = line.cells.find((cell) => cell.value === "界");
    const combining = line.cells.find((cell) => cell.value === "e\u0301");

    expect(displayWidth(line.text)).toBe(8);
    expect(wide).toMatchObject({ width: 2, column: 0 });
    expect(combining).toMatchObject({ value: "e\u0301", width: 1, column: 2 });
    expect(sliceDisplayLine(line, 0, 1)).toBe("界");
    expect(sliceDisplayLine(line, 2, 2)).toBe("e\u0301");
    expect(sliceDisplayLine(line, 3, 3)).toBe("x");
  });

  it("truncates by display columns and reserves the ellipsis column", () => {
    const line = truncateDisplayLine("abcdef界", 5);

    expect(line.text).toBe("abcd…");
    expect(displayWidth(line.text)).toBe(5);
  });
});

describe("screen-line integration", () => {
  const entry: ResultEntry = {
    id: 1,
    command: "x",
    output: `${STYLED}界e\u0301`,
    ok: true,
  };

  it("pads every card row to the same terminal width and keeps borders aligned", () => {
    const width = 14;
    const lines = buildScreenLines([entry], 0, 8, width);

    expect(lines).toHaveLength(8);
    for (const line of lines) {
      expect(displayWidth(line.text)).toBe(width);
      expect(line.text).not.toContain("\x1b");
      expect(line.cells?.at(-1)?.column).toBe(width - 1);
    }
    expect(lines[0]!.cells?.at(-1)?.value).toBe("╮");
    expect(lines[5]!.cells?.at(-1)?.value).toBe("╯");
  });

  it("extracts a clean selection across ANSI, wide, and combining text", () => {
    const lines = buildScreenLines([entry], 0, 8, 14);
    const selected = extendSelection(startSelection(3, 2), 3, 7);

    // wrap-ansi normalizes plain graphemes to NFC before the line is built;
    // either representation is one indivisible terminal cell cluster.
    expect(extractSelectionText(lines, selected)).toBe("red界é");
    expect(extractSelectionText(lines, selected)).not.toContain("\x1b");
  });
});
