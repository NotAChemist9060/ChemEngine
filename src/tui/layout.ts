/**
 * Pure layout math for the fixed full-screen console.
 * Decides, for a given terminal size, which chrome fits and how many result
 * cards the middle area shows at once (the scroll page).
 */
export interface Layout {
  showBanner: boolean;
  showInfo: boolean;
  showGuide: boolean;
  /** Guide panel width in columns (0 when hidden). */
  guideWidth: number;
  /** How many result cards are visible in the middle scroller at once. */
  pageSize: number;
}

/** Terminal narrower than this hides the guide panel. */
export const MIN_GUIDE_COLUMNS = 105;
/** Terminal with fewer rows than this hides the info strip + footer. */
export const MIN_CHROME_ROWS = 14;
/** Terminal with fewer rows than this hides the banner. */
export const MIN_BANNER_ROWS = 6;

/** Row heights of the chrome pieces (measured from the components). */
const BANNER_ROWS = 5; // double border + paddingY 1 + 1 content line
const INFO_ROWS = 1;
const FOOTER_ROWS = 3; // single border box + 1 content line
const INPUT_ROWS = 1;
/** Extra breathing room (padding/spacing between chrome pieces). */
function gapRows(rows: number): number {
  return rows >= 12 ? 2 : 1;
}

/** Approximate rows occupied by one result card. */
const ROWS_PER_CARD = 4;

export function layout(rows: number, cols: number, guideOn: boolean, resultLimit: number): Layout {
  const showBanner = rows >= MIN_BANNER_ROWS;
  const showInfo = rows >= MIN_CHROME_ROWS;
  const showGuide = guideOn && cols >= MIN_GUIDE_COLUMNS && rows >= 12;
  const guideWidth = showGuide ? Math.min(48, Math.max(30, Math.floor(cols * 0.3))) : 0;

  const bannerRows = showBanner ? BANNER_ROWS : 0;
  const infoRows = showInfo ? INFO_ROWS : 0;
  const footerRows = showInfo ? FOOTER_ROWS : 0;
  const available = Math.max(1, rows - bannerRows - infoRows - footerRows - INPUT_ROWS - gapRows(rows));
  const pageSize = Math.max(1, Math.min(resultLimit, Math.floor(available / ROWS_PER_CARD) + 1));

  return { showBanner, showInfo, showGuide, guideWidth, pageSize };
}