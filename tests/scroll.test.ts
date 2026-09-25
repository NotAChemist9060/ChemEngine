import { describe, expect, it } from "vitest";
import {
  MARKER_ROWS,
  WHEEL_STEP,
  cardRows,
  clampScroll,
  normalizeScrollTop,
  pageStep,
  resultHeights,
  scrollGeometry,
  scrollMax,
  visibleRange,
  wrappedLines,
} from "../src/tui/scroll.ts";

describe("TUI scroll math", () => {
  it("counts wrapped lines exactly like Ink's Text wrap", () => {
    // Ink default wrap = wrapAnsi(text, width, { trim: false, hard: true }).
    expect(wrappedLines("abcdefgh", 4)).toBe(2);
    expect(wrappedLines("abcdefghij", 4)).toBe(3); // 4 + 4 + 2
    expect(wrappedLines("hello world foo", 6)).toBe(3);
    expect(wrappedLines("ab cd", 2)).toBe(3); // trim:false keeps the space line
    expect(wrappedLines("hi", 30)).toBe(1);
    expect(wrappedLines("", 10)).toBe(1);
  });

  it("computes card height from chrome + wrapped header/body", () => {
    // 2 borders + 2 paddingY = 4 chrome rows, plus wrapped header/body.
    expect(cardRows("hi", "hello", 30)).toBe(6); // inner = 30 - 4 = 26, no wrap
    expect(cardRows("header", "abcdefghijklmnopqrstuvwxyz0123456789", 30)).toBe(7); // 36-char body wraps to 2 lines
    expect(cardRows("header", "body", 10)).toBe(6); // inner = 6, still one line each
  });

  it("adds the inter-card gap row to every card but the last", () => {
    const one = resultHeights([{ id: 1, command: "a", output: "b", ok: true }], 30);
    expect(one).toEqual([6]); // no gap after the last card
    const three = resultHeights(
      [
        { id: 1, command: "a", output: "b", ok: true },
        { id: 2, command: "c", output: "d", ok: true },
        { id: 3, command: "e", output: "f", ok: true },
      ],
      30,
    );
    expect(three).toEqual([7, 7, 6]);
    expect(resultHeights([], 30)).toEqual([]);
  });

  it("computes the farthest scroll offset that still shows the newest content", () => {
    // 20 content rows − (10 viewport − 2 marker/spacer rows) = 12.
    expect(scrollMax([7, 7, 6], 10)).toBe(12);
    expect(scrollMax([3], 5)).toBe(0); // content fits → no scroll
    expect(scrollMax([], 5)).toBe(0);
  });

  it("resolves one geometry for marker space, the true bottom, and the visible range", () => {
    const pinned = scrollGeometry([7, 7, 6], 10, null);
    expect(pinned).toMatchObject({
      totalRows: 20,
      max: 12,
      top: 12,
      markerRows: MARKER_ROWS,
      contentRows: 8,
      range: { start: 1, end: 3 },
    });

    const top = scrollGeometry([7, 7, 6], 10, 0);
    expect(top).toMatchObject({ max: 12, top: 0, markerRows: 0, contentRows: 10 });
    expect(top.range.start).toBe(0);

    const clamped = scrollGeometry([7, 7, 6], 10, 99);
    expect(clamped).toMatchObject({ top: 12, markerRows: MARKER_ROWS });
  });

  it("clamps scroll offsets into [0, max]", () => {
    expect(clampScroll(-2, 13)).toBe(0);
    expect(clampScroll(20, 13)).toBe(13);
    expect(clampScroll(5, 13)).toBe(5);
    expect(clampScroll(9, 0)).toBe(0);
  });

  it("normalizes explicit offsets and re-pins the bottom sentinel", () => {
    expect(normalizeScrollTop(5, 12)).toBe(5);
    expect(normalizeScrollTop(12, 12)).toBeNull();
    expect(normalizeScrollTop(20, 12)).toBeNull();
    expect(normalizeScrollTop(-2, 12)).toBe(0);
    expect(normalizeScrollTop(null, 12)).toBeNull();
  });

  it("finds cards intersecting the visible row window", () => {
    const heights = [7, 7, 7]; // cards span rows 0-7, 7-14, 14-21
    expect(visibleRange(0, heights, 10)).toEqual({ start: 0, end: 2 }); // card 1 straddles the bottom edge
    expect(visibleRange(8, heights, 10)).toEqual({ start: 1, end: 3 });
    expect(visibleRange(14, heights, 10)).toEqual({ start: 2, end: 3 });
    expect(visibleRange(0, [], 10)).toEqual({ start: 0, end: 0 });
  });

  it("pages by one viewport minus a row, never below 1", () => {
    expect(pageStep(30)).toBe(29);
    expect(pageStep(1)).toBe(1);
    expect(pageStep(0)).toBe(1);
    expect(WHEEL_STEP).toBe(3);
  });
});