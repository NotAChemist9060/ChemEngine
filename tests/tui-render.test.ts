import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "ink";
import { classify } from "../src/knowledge/classify.ts";
import { renderClassification } from "../src/cli/render.ts";
import { Banner, EngineInfo } from "../src/tui/banner.ts";
import { Footer } from "../src/tui/footer.ts";
import { Guide, guideSections } from "../src/tui/guide.ts";
import { InputBar } from "../src/tui/inputbar.ts";
import { Palette } from "../src/tui/palette.ts";
import { ResultPane } from "../src/tui/resultpane.ts";
import { layout, viewHeight, BANNER_ROWS, FOOTER_ROWS, INFO_ROWS, INPUT_ROWS } from "../src/tui/layout.ts";
import { box } from "../src/tui/el.ts";
import type { ResultEntry } from "../src/tui/state.ts";

/** Headless render of a TUI component — Ink supports string rendering (no TTY needed). */
function render(node: Parameters<typeof renderToString>[0], options?: Parameters<typeof renderToString>[1]): string {
  return renderToString(node, options);
}

/**
 * Three short cards at width 40 → heights [7, 7, 6] (20 rows total), so a
 * 6-row viewport can never hold all three and every `visibleRange` window is
 * deterministic.
 */
const THREE_SHORT = [
  { id: 1, command: "one", output: "alpha", ok: true },
  { id: 2, command: "two", output: "beta", ok: true },
  { id: 3, command: "three", output: "gamma", ok: true },
] satisfies readonly ResultEntry[];

/**
 * Full pinned app frame — mirrors app.ts chrome (explicit heights +
 * flexShrink: 0 + overflowY: hidden) so tests pin real layout rows.
 * Rendered statically the columns interleave at ~80 cols; row positions are
 * what the assertions rely on.
 */
function renderFrame(rows: number, cols: number, guideOn: boolean, results: readonly ResultEntry[]): string {
  // Mirror app.ts: the frame is one row under the terminal (VIEW_PAD) so Ink
  // uses incremental rendering instead of fullscreen force-clears.
  const view = viewHeight(rows);
  const lay = layout(view, cols, guideOn);
  const cardWidth = cols - lay.guideWidth - 2;
  const frame = box(
    { flexDirection: "column", height: view },
    lay.showBanner
      ? box({ height: BANNER_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(Banner, { version: "0.2.5" }))
      : null,
    lay.showInfo
      ? box({ height: INFO_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(EngineInfo, { elementCount: 118 }))
      : null,
    lay.viewportRows > 0
      ? box(
          { height: lay.viewportRows, flexShrink: 0, flexDirection: "column", overflowY: "hidden" },
          box(
            { flexDirection: "row", flexGrow: 1 },
            box(
              { flexGrow: 1, flexDirection: "column", overflowY: "hidden" },
              createElement(ResultPane, { results, scrollTop: null, viewportRows: lay.viewportRows, width: cardWidth }),
            ),
            lay.showGuide
              ? createElement(Guide, {
                  sections: guideSections({ version: "0.2.5", commands: ["balance", "element"], elementCount: 118 }),
                  width: lay.guideWidth,
                })
              : null,
          ),
        )
      : null,
    box({ height: INPUT_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(InputBar, { value: "H2 + O2", cursor: 2 })),
    lay.showInfo ? box({ height: FOOTER_ROWS, flexShrink: 0, flexDirection: "column" }, createElement(Footer, {})) : null,
  );
  return render(frame);
}

describe("TUI presentation layer", () => {
  it("renders the banner with the version", () => {
    const out = render(createElement(Banner, { version: "0.2.5" }));
    expect(out).toContain("ChemEngine v0.2.5");
    expect(out).toContain("autonomous · offline · local");
    expect(out).toContain("╔"); // double border
  });

  it("renders the engine info strip", () => {
    const out = render(createElement(EngineInfo, { elementCount: 118 }));
    expect(out).toContain("118 elements embedded");
    expect(out).toContain("no network");
  });

  it("renders the guide panel with sections", () => {
    const sections = guideSections({ version: "0.2.5", commands: ["balance", "element"], elementCount: 118 });
    const out = render(createElement(Guide, { sections, width: 40 }));
    expect(out).toContain("GUIDE");
    expect(out).toContain("Commands");
    expect(out).toContain("^G show/hide this guide");
    expect(out).toContain("118 elements embedded");
    expect(out).toContain("┌"); // single border
  });

  it("renders the footer key hints", () => {
    // Full hint is 82 display cols — render at a realistic TTY width instead of
    // ink's 80-col default so `^C exit` isn't truncated by the wrap: truncate guard.
    const out = render(createElement(Footer, {}), { columns: 120 });
    expect(out).toContain("Tab ·");
    expect(out).toContain("PgUp/Dn · wheel"); // M2b.1: wheel hint added
    expect(out).toContain("^C exit");
    expect(out.split("\n")).toHaveLength(3); // stays 1 content row (truncate, no wrap)
  });

  it("renders the input bar with the cursor glyph", () => {
    const out = render(createElement(InputBar, { value: "balance H2 + O2 -> H2O", cursor: 7 }));
    expect(out).toContain("chem> balance");
  });

  it("renders result cards with error coloring signal for failures", () => {
    const out = render(
      createElement(ResultPane, {
        results: [
          { id: 1, command: "balance CH4 + O2 -> CO2 + H2O", output: "CH4 + 2O2 -> CO2 + 2H2O", ok: true },
          { id: 2, command: "balnce", output: "unknown command 'balnce'", ok: false },
        ],
        scrollTop: 0,
        viewportRows: 16,
        width: 40,
      }),
    );
    expect(out).toContain("CH4 + 2O2 -> CO2 + 2H2O");
    expect(out).toContain("unknown command 'balnce'");
    expect(out).toContain("#1");
    expect(out).toContain("╭"); // round borders
  });

  it("renders a classify card from the real command output", () => {
    const output = renderClassification(classify("C2H6O"));
    const out = render(
      createElement(ResultPane, {
        results: [{ id: 1, command: "classify C2H6O", output, ok: true }],
        scrollTop: 0,
        viewportRows: 24,
        width: 60,
      }),
    );
    expect(out).toContain("#1");
    expect(out).toContain("classify C2H6O");
    expect(out).toContain("ethanol");
    expect(out).toContain("alcohol");
    expect(out).toContain("Limits:"); // the honest limit travels with the card
  });

  it("renders the empty state", () => {
    const out = render(createElement(ResultPane, { results: [], scrollTop: null, viewportRows: 10, width: 40 }));
    expect(out).toContain("No results yet");
  });

  it("slices to only the card visible at the top of the scroll range", () => {
    const out = render(createElement(ResultPane, { results: THREE_SHORT, scrollTop: 0, viewportRows: 6, width: 40 }));
    expect(out).toContain("alpha");
    expect(out).not.toContain("beta");
    expect(out).not.toContain("gamma");
    expect(out).not.toContain("rows above"); // at the top → no scrolled-off marker
  });

  it("autoscrolls to the newest card when scrollTop is null", () => {
    const out = render(createElement(ResultPane, { results: THREE_SHORT, scrollTop: null, viewportRows: 6, width: 40 }));
    expect(out).toContain("gamma"); // newest card is rendered
    expect(out).toContain("rows above"); // older rows are scrolled off
    expect(out).not.toContain("alpha");
    expect(out).not.toContain("beta");
  });

  it("shows the scrolled-off marker with an exact, row-truthful window", () => {
    const out = render(createElement(ResultPane, { results: THREE_SHORT, scrollTop: 5, viewportRows: 6, width: 40 }));
    // The window starts 5 rows into (three-short) card 1 ([7,7,6] heights):
    // its bottom border, the inter-card gap, then card 2's top border and
    // first padding row. Content scrolled past is never re-snapped back — the
    // "▲ N rows above" count is the exact clip point.
    expect(out).toContain("▲ 5 rows above — scroll down");
    expect(out).toContain("╰"); // card 1 bottom border (row 5 of 7)
    expect(out).toContain("╭"); // card 2 top border (window row 4)
    expect(out).not.toContain("alpha"); // card 1 body is above the window
    expect(out).not.toContain("beta"); // card 2 body is below the clip
    expect(out).not.toContain("gamma");
  });

  it("pins the full 24×160 frame with guide and 4 tall results", () => {
    const tall = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      command: `tail${i + 1}`,
      output: "lorem ipsum dolor ".repeat(15),
      ok: true,
    }));
    const out = renderFrame(24, 160, true, tall);
    const lines = out.split("\n");
    const view = viewHeight(24);
    const lay = layout(view, 160, true);
    expect(lines).toHaveLength(view); // chrome pinned one row under the terminal, center clipped
    expect(lines[lay.inputRow - 1]).toContain("chem>"); // input pinned to the bottom chrome row
    expect(lines[lay.inputRow]).toContain("┌"); // footer top border
    expect(lines[view - 1]).toContain("└"); // footer bottom border
    expect(out).toMatch(/▲ \d+ rows above/); // scrolled-off rows are announced
    expect(out).toContain("╭"); // at least one result card is rendered (round border)
  });

  it("keeps the input line on-screen across terminal geometries", () => {
    const geometries = [
      [5, 40],
      [8, 80],
      [12, 80],
      [14, 80],
      [24, 160],
      [40, 200],
      [60, 200],
    ] as const;
    for (const [rows, cols] of geometries) {
      const view = viewHeight(rows);
      const lay = layout(view, cols, true);
      const out = renderFrame(rows, cols, true, THREE_SHORT);
      const lines = out.split("\n");
      expect(lines, `${rows}×${cols}`).toHaveLength(view); // chrome can never exceed the frame
      // Input is pinned to the bottom-most chrome row — never pushed off-screen.
      expect(lines[lay.inputRow - 1], `${rows}×${cols}`).toContain("chem>");
    }
  });

  it("renders the command palette with the active row highlighted", () => {
    const out = render(
      createElement(Palette, {
        items: [
          { name: "balance", summary: "Balance a chemical equation" },
          { name: "element", summary: "Query periodic table data" },
        ],
        index: 0,
        query: "bal",
      }),
    );
    expect(out).toContain("/bal");
    expect(out).toContain("> balance  Balance a chemical equation");
    expect(out).toContain("element  Query periodic table data");
  });
});