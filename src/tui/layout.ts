/**
 * Pure layout math for the fixed full-screen console.
 * Decides, for a given terminal size, which chrome fits and how many rows the
 * center (input/output) region gets. The center viewport is an *exact* height:
 * chrome pieces (banner, info, input, footer) are pinned with explicit heights
 * and `flexShrink: 0` so they can never be squeezed away by tall content.
 */
export interface Layout {
  showBanner: boolean;
  showInfo: boolean;
  showGuide: boolean;
  /** Guide panel width in columns (0 when hidden). */
  guideWidth: number;
  /** Exact rows available for the center results viewport. */
  viewportRows: number;
  /** 1-based terminal row of the results viewport's first row (chrome above it). */
  viewportTop: number;
  /** Result card width in columns (full width minus guide panel minus 2 margins). */
  resultWidth: number;
  /** 1-based terminal row of the input line (for mouse click mapping). */
  inputRow: number;
}

/** Terminal narrower than this hides the guide panel. */
export const MIN_GUIDE_COLUMNS = 105;
/** Terminal with fewer rows than this hides the info strip + footer. */
export const MIN_CHROME_ROWS = 14;
/** Terminal with fewer rows than this hides the banner. */
export const MIN_BANNER_ROWS = 6;

/**
 * Rows reserved *under* the viewport. The TUI frame is rendered one row shorter
 * than the terminal so Ink never classifies it as fullscreen: on Windows Ink
 * force-clears the whole terminal on every fullscreen frame (ink#969
 * workaround), which visibly blinks the lower half while typing. At
 * `rows - 1` Ink uses its incremental diff renderer (changed cells only).
 * Uniform on all platforms so layout math and tests are deterministic.
 */
export const VIEW_PAD = 1;

/** Frame height for a terminal of `rows` rows (always ≥ 1). */
export const viewHeight = (rows: number): number => Math.max(1, rows - VIEW_PAD);

/** Row heights of the chrome pieces (measured from the components). */
export const BANNER_ROWS = 5; // double border + paddingY 1 + 1 content line
export const INFO_ROWS = 1;
export const FOOTER_ROWS = 3; // single border box + 1 content line
export const INPUT_ROWS = 1;

/**
 * First column of the results region inside the frame (1 — the results region
 * owns the left margin column) plus the ResultPane's paddingX (1). Selection
 * and mouse coordinates treat col 0 as the card's left border glyph.
 */
export const RESULT_LEFT = 2;

export function layout(rows: number, cols: number, guideOn: boolean): Layout {
  const showBanner = rows >= MIN_BANNER_ROWS;
  const showInfo = rows >= MIN_CHROME_ROWS;
  const showGuide = guideOn && cols >= MIN_GUIDE_COLUMNS && rows >= 12;
  const guideWidth = showGuide ? Math.min(48, Math.max(30, Math.floor(cols * 0.3))) : 0;

  const bannerRows = showBanner ? BANNER_ROWS : 0;
  const infoRows = showInfo ? INFO_ROWS : 0;
  const footerRows = showInfo ? FOOTER_ROWS : 0;
  // The center viewport may collapse to 0 rows on tiny windows — it must never
  // be forced to ≥1, because that could make chrome + viewport exceed `rows`
  // and push the input line off-screen (visible when the user resizes smaller).
  const viewportRows = Math.max(0, rows - bannerRows - infoRows - footerRows - INPUT_ROWS);
  // 1-based terminal row of results row 0: frame row 1 is the top, then banner
  // and info rows (both hidden when the terminal is too short).
  const viewportTop = 1 + (showBanner ? BANNER_ROWS : 0) + (showInfo ? INFO_ROWS : 0);
  // Result card width: guideWidth is 0 when hidden, so cols - guideWidth is the
  // results region width; the pane owns 1 margin column per side.
  const resultWidth = Math.max(1, cols - guideWidth - 2);
  const inputRow = rows - footerRows;

  return { showBanner, showInfo, showGuide, guideWidth, viewportRows, viewportTop, resultWidth, inputRow };
}