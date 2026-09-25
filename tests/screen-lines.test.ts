import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "ink";
import { buildScreenLines } from "../src/tui/scroll.ts";
import { ResultPane } from "../src/tui/resultpane.ts";
import { box } from "../src/tui/el.ts";
import type { ResultEntry } from "../src/tui/state.ts";

const OK = { id: 1, command: "a", output: "hello", ok: true } satisfies ResultEntry;
const BAD = { id: 2, command: "b", output: "error!", ok: false } satisfies ResultEntry;

/** Strip ANSI and the pane's leading paddingX column; drop trailing whitespace. */
const ANSI = /\x1b\[[0-9;]*m/g;
function norm(line: string): string {
  return line.replace(ANSI, "").slice(1).replace(/\s+$/, "");
}

/**
 * Render ResultPane exactly as the app frames it: a width-constrained column
 * (stretch, so the marker row truncates at the cards' content width) with a
 * fixed viewport height and overflow clipped. Returns the rendered rows.
 */
function renderPane(
  results: readonly ResultEntry[],
  scrollTop: number | null,
  viewportRows: number,
  width: number,
): string[] {
  const node = box(
    { flexDirection: "column", height: viewportRows, overflowY: "hidden" },
    box(
      { width: width + 2, flexDirection: "column", overflowY: "hidden" },
      createElement(ResultPane, { results, scrollTop, viewportRows, width }),
    ),
  );
  return renderToString(node, { columns: 200 }).split("\n");
}

describe("TUI screen-line model — card composition", () => {
  it("builds a single card's exact rows (round borders, padding, header, body)", () => {
    const lines = buildScreenLines([OK], 0, 10, 10);
    expect(lines).toHaveLength(10); // always exactly viewportRows lines
    expect(lines[0]).toMatchObject({ text: "╭────────╮", card: true, border: "green" });
    expect(lines[1]).toMatchObject({ text: "│        │", card: true });
    expect(lines[2]).toMatchObject({ text: "│ #1 $ a │", card: true, dim: true });
    expect(lines[3]).toMatchObject({ text: "│ hello  │", card: true });
    expect(lines[4]).toMatchObject({ text: "│        │", card: true });
    expect(lines[5]).toMatchObject({ text: "╰────────╯", card: true });
    expect(lines[6]).toMatchObject({ text: "          ", card: false }); // blank fill
    // row numbers are 0-based viewport-local
    expect(lines.map((l) => l.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("flags failing results with a red border", () => {
    const lines = buildScreenLines([BAD], 0, 10, 10);
    expect(lines[0]!.border).toBe("red");
    expect(lines[0]!.text).toBe("╭────────╮");
  });

  it("wraps long output inside the card and keeps exact row widths", () => {
    const wide = { id: 1, command: "x", output: "abcdefghijklmnopqrstuvwxyz0123456789", ok: true } satisfies ResultEntry;
    const lines = buildScreenLines([wide], 0, 14, 10); // inner = 6 → 36-char body wraps to 6 lines
    expect(lines.filter((l) => l.card)).toHaveLength(11); // 2 borders + 2 pad + 1 header + 6 body
    const bodyRows = lines.filter((l) => l.card && !l.dim && /^│ .*[^ ] │$/.test(l.text));
    expect(bodyRows).toHaveLength(6);
    expect(bodyRows[0]!.text).toContain("abcdef");
    expect(bodyRows[5]!.text).toContain("789");
    for (const l of lines.filter((x) => x.card)) expect(l.text).toHaveLength(10);
  });

  it("puts one gap row between cards but never after the last", () => {
    const lines = buildScreenLines([OK, BAD], 0, 14, 10);
    // card 1 = rows 0-5, gap = row 6, card 2 = rows 7-12 (no trailing gap)
    expect(lines[6]).toMatchObject({ text: "          ", card: false });
    expect(lines[7]).toMatchObject({ text: "╭────────╮", card: true, border: "red" });
    expect(lines[13]).toMatchObject({ text: "          ", card: false }); // blank fill
  });
});

describe("TUI screen-line model — marker rows and blank fill", () => {
  it("places marker + gap at rows 0-1, then the windowed content from row 2", () => {
    // [OK, BAD] at width 40 → heights [7, 6] (13 rows); viewport 10, marker →
    // cardViewport 9, max 4. top=4 clips into card 1 (pad + bottom border),
    // then the gap and card 2 entirely.
    const lines = buildScreenLines([OK, BAD], 5, 10, 40);
    expect(lines).toHaveLength(10);
    expect(lines[0]).toMatchObject({ text: "▲ 4 rows above — scroll down".padEnd(40), dim: true, card: false });
    expect(lines[1]).toMatchObject({ text: " ".repeat(40), card: false });
    expect(lines[2]!.text).toMatch(/^│ .* │$/); // card 1, clipped to its pad row
    expect(lines[3]).toMatchObject({ text: `╰${"─".repeat(38)}╯`, card: true, border: "green" }); // card 1 bottom border
    expect(lines[4]).toMatchObject({ text: " ".repeat(40), card: false }); // gap
    expect(lines[5]!.text).toContain("╭"); // card 2 top border
    expect(lines[7]!.text).toContain("#2 $ b"); // card 2 header (row-start skip worked)
    expect(lines[9]).toMatchObject({ card: true, border: "red" }); // card 2 clipped below its bottom border
    expect(lines[9]!.text).toMatch(/^│ .* │$/);
  });

  it("returns all-blank rows for an empty result set", () => {
    const lines = buildScreenLines([], 0, 4, 10);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.text === " ".repeat(10) && !l.card && l.border === undefined)).toBe(true);
  });

  it("clips content at the viewport bottom", () => {
    const lines = buildScreenLines([OK], 0, 4, 10); // card is 6 rows but viewport is 4
    expect(lines).toHaveLength(4);
    expect(lines[0]!.text).toBe("╭────────╮");
    expect(lines[3]!.text).toBe("│ hello  │"); // bottom half of the card is clipped away
  });
});

describe("TUI screen-line model — parity with the real render", () => {
  const THREE = [
    OK,
    BAD,
    { id: 3, command: "c", output: "gamma gamma gamma", ok: true },
  ] as const;
  // Frame-parity is reliable only when no marker is shown AND the content fits
// without overflow: renderToString squeezes/overlaps overflowing rows, so the
// scrolled (marker) cases are covered by unit tests instead.
  const cases: Array<[string, readonly ResultEntry[], number | null, number, number]> = [
    ["single wrapped card fits", [OK], 0, 12, 8],
    ["two cards exactly fit", [OK, BAD], 0, 14, 14],
    ["three cards fit", THREE, 0, 22, 14],
    ["autoscroll (clamps to 0)", [OK, BAD], null, 20, 14],
  ];

  it.each(cases)("%s — screen lines match the pane's rendered rows", (_name, results, scrollTop, viewportRows, width) => {
    const rendered = renderPane(results, scrollTop, viewportRows, width);
    const lines = buildScreenLines(results, scrollTop, viewportRows, width);
    expect(rendered).toHaveLength(viewportRows);
    for (let i = 0; i < viewportRows; i++) {
      expect(lines[i], `line ${i}`).toBeDefined();
      const r = norm(rendered[i] ?? "");
      const b = (lines[i]!.text ?? "").replace(/\s+$/, "");
      expect(b, `row ${i} (rendered=${JSON.stringify(rendered[i])})`).toBe(r);
    }
  });
});