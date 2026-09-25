import { createElement } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Text } from "ink";
import { box } from "./el.ts";
import {
  displayWidth,
  makeDisplayLine,
  type DisplayCell,
  type DisplayStyle,
} from "./display.ts";
import { buildScreenLines, type PaneLine } from "./scroll.ts";
import { normalizedBox, type Selection } from "./select.ts";
import type { ResultEntry } from "./state.ts";

export interface ResultPaneProps {
  results: readonly ResultEntry[];
  /** Effective, already-clamped scroll offset in content rows (0 = oldest first). */
  scrollTop: number | null;
  /** Exact rows this pane is allowed to occupy. */
  viewportRows: number;
  /** Card width in columns (border + padding included). */
  width: number;
  /**
   * Active drag selection (viewport-local). The pane renders one screen-line
   * grid in both states — the same rows `buildScreenLines` models — and the
   * selection only changes per-cell styles, so switching into a drag never
   * reflows the pane and selection always matches extraction.
   */
  selection?: Selection | null;
}

/** Box-drawn glyphs of the round border style — these carry the card's border color. */
const BORDER_GLYPHS = new Set(["╭", "╮", "╰", "╯", "│", "─"]);

type TextProps = ComponentProps<typeof Text>;

function cellsFor(line: PaneLine): readonly DisplayCell[] {
  return line.cells ?? makeDisplayLine(line.text, displayWidth(line.text)).cells;
}

function selectedCell(selection: Selection, row: number, cell: DisplayCell): boolean {
  const box = normalizedBox(selection);
  if (row < box.top || row > box.bottom) return false;
  if (cell.width === 0) return cell.column >= box.left && cell.column <= box.right;
  return cell.column <= box.right && cell.column + cell.width - 1 >= box.left;
}

function propsFor(line: PaneLine, cell: DisplayCell, selection: Selection | null): TextProps {
  if (selection !== null && selectedCell(selection, line.row, cell)) {
    return { inverse: true };
  }

  if (line.card && cell.width === 1 && BORDER_GLYPHS.has(cell.value) && line.border !== undefined) {
    return { color: line.border };
  }

  const style: DisplayStyle = cell.style;
  return {
    ...(style.bold === true ? { bold: true } : {}),
    ...(style.dimColor === true || line.dim === true ? { dimColor: true } : {}),
    ...(style.italic === true ? { italic: true } : {}),
    ...(style.underline === true ? { underline: true } : {}),
    ...(style.strikethrough === true ? { strikethrough: true } : {}),
    ...(style.inverse === true ? { inverse: true } : {}),
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.backgroundColor !== undefined ? { backgroundColor: style.backgroundColor } : {}),
  };
}

function styleKey(props: TextProps): string {
  return JSON.stringify(props);
}

/**
 * Screen-line render path: one `<Text>` per `buildScreenLines` row, split into
 * runs by normalized display cells and their visible SGR state:
 *
 * - selected cells → flat `inverse` (the highlight is the background swap;
 *   no color/dim so it stays readable on any row);
 * - box border glyphs (`╭╮╰╯│─`) → the card's `border` color, never dim;
 * - everything else retains the body styling parsed from its SGR sequences,
 *   with the existing header/marker dim baseline.
 *
 * Because runs are coalesced by display cells rather than JavaScript string
 * indexes, wide graphemes and combining clusters stay intact.
 */
function renderGrid(
  results: readonly ResultEntry[],
  scrollTop: number | null,
  viewportRows: number,
  width: number,
  selection: Selection | null,
): ReactNode {
  const lines = buildScreenLines(results, scrollTop, viewportRows, width);
  const rows: ReactNode[] = lines.map((line) => {
    const spans: ReactNode[] = [];
    let runKey: string | undefined;
    let runStart = 0;
    let runText = "";
    let runProps: TextProps = {};

    const flush = (): void => {
      if (runText === "") return;
      spans.push(createElement(Text, { key: `c${runStart}`, ...runProps }, runText));
      runText = "";
    };

    for (const cell of cellsFor(line)) {
      const props = propsFor(line, cell, selection);
      const key = styleKey(props);
      if (runKey === undefined) {
        runKey = key;
        runStart = cell.column;
        runProps = props;
      } else if (key !== runKey) {
        flush();
        runKey = key;
        runStart = cell.column;
        runProps = props;
      }
      runText += cell.value;
    }
    flush();
    return createElement(Text, { key: `row${line.row}` }, ...spans);
  });
  return box({ flexDirection: "column", paddingX: 1 }, ...rows);
}

export function ResultPane({ results, scrollTop, viewportRows, width, selection }: ResultPaneProps) {
  if (results.length === 0) {
    return box(
      { paddingX: 1, paddingY: 1 },
      createElement(Text, { dimColor: true }, "No results yet — type a command, or press / for the palette."),
    );
  }
  return renderGrid(results, scrollTop, viewportRows, width, selection ?? null);
}
