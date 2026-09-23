import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "ink";
import { Banner, EngineInfo } from "../src/tui/banner.ts";
import { Footer } from "../src/tui/footer.ts";
import { Guide, guideSections } from "../src/tui/guide.ts";
import { InputBar } from "../src/tui/inputbar.ts";
import { Palette } from "../src/tui/palette.ts";
import { ResultPane } from "../src/tui/resultpane.ts";

/** Headless render of a TUI component — Ink supports string rendering (no TTY needed). */
function render(node: Parameters<typeof renderToString>[0]): string {
  return renderToString(node);
}

describe("TUI presentation layer", () => {
  it("renders the banner with the version", () => {
    const out = render(createElement(Banner, { version: "0.2.0" }));
    expect(out).toContain("ChemEngine v0.2.0");
    expect(out).toContain("autonomous · offline · local");
    expect(out).toContain("╔"); // double border
  });

  it("renders the engine info strip", () => {
    const out = render(createElement(EngineInfo, { elementCount: 118 }));
    expect(out).toContain("118 elements embedded");
    expect(out).toContain("no network");
  });

  it("renders the guide panel with sections", () => {
    const sections = guideSections({ version: "0.2.0", commands: ["balance", "element"], elementCount: 118 });
    const out = render(createElement(Guide, { sections, width: 40 }));
    expect(out).toContain("GUIDE");
    expect(out).toContain("Commands");
    expect(out).toContain("^G show/hide this guide");
    expect(out).toContain("118 elements embedded");
    expect(out).toContain("┌"); // single border
  });

  it("renders the footer key hints", () => {
    const out = render(createElement(Footer, {}));
    expect(out).toContain("Tab ·");
    expect(out).toContain("^C exit");
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
        limit: 8,
        scrollOffset: 0,
      }),
    );
    expect(out).toContain("CH4 + 2O2 -> CO2 + 2H2O");
    expect(out).toContain("unknown command 'balnce'");
    expect(out).toContain("#1");
    expect(out).toContain("╭"); // round borders
  });

  it("renders the empty state", () => {
    const out = render(createElement(ResultPane, { results: [], limit: 8, scrollOffset: 0 }));
    expect(out).toContain("No results yet");
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

  it("renders the scrolled marker when results are older", () => {
    const out = render(
      createElement(ResultPane, {
        results: [
          { id: 1, command: "a", output: "b", ok: true },
          { id: 2, command: "c", output: "d", ok: true },
        ],
        limit: 1,
        scrollOffset: 1,
      }),
    );
    expect(out).toContain("1 older result");
  });
});