import ansiRegex from "ansi-regex";
import stringWidth from "string-width";

/**
 * The small set of SGR attributes Ink can render on a Text node. ANSI input is
 * parsed into this data model before it reaches the screen-line grid; escape
 * sequences themselves never become part of a selectable line.
 */
export interface DisplayStyle {
  bold?: boolean;
  dimColor?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  color?: string;
  backgroundColor?: string;
}

/** One grapheme cluster positioned at a terminal display column. */
export interface DisplayCell {
  /** The visible grapheme (or a padding space); never contains ANSI bytes. */
  value: string;
  /** Terminal columns occupied by this grapheme: normally 0, 1, or 2. */
  width: number;
  /** Zero-based display column where the grapheme starts. */
  column: number;
  /** SGR state in effect for this grapheme. */
  style: DisplayStyle;
}

/** A normalized, display-width-safe line. */
export interface DisplayLine {
  /** Plain visible text, padded to exactly `width` display columns. */
  text: string;
  /** Grapheme/cell metadata used for styling, selection, and slicing. */
  cells: readonly DisplayCell[];
  /** Exact terminal display width. */
  width: number;
}

interface DisplayToken {
  value: string;
  width: number;
  style: DisplayStyle;
}

const segmenter = new Intl.Segmenter();
const SGR_RE = /^(?:\u001B\[|\u009B)([0-9;:]*)(?:m)$/;

const FOREGROUND_COLORS: Readonly<Record<number, string>> = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "blackBright",
  91: "redBright",
  92: "greenBright",
  93: "yellowBright",
  94: "blueBright",
  95: "magentaBright",
  96: "cyanBright",
  97: "whiteBright",
};

/** Return the terminal display width of text, ignoring ANSI control bytes. */
export function displayWidth(text: string): number {
  return stringWidth(text);
}

function cloneStyle(style: DisplayStyle): DisplayStyle {
  return { ...style };
}

function parseSgrParameters(parameters: string): number[] {
  if (parameters === "") return [0];
  return parameters.split(/[;:]/).map((part) => {
    if (part === "") return 0;
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

function deleteStyle(style: DisplayStyle, key: keyof DisplayStyle): void {
  delete style[key];
}

/** Apply one SGR sequence to the current style state. */
function applySgr(style: DisplayStyle, sequence: string): DisplayStyle {
  const match = SGR_RE.exec(sequence);
  if (match === null) return style;

  const next = cloneStyle(style);
  const parameters = parseSgrParameters(match[1] ?? "");
  for (let index = 0; index < parameters.length; index++) {
    const code = parameters[index]!;
    switch (code) {
      case 0:
        for (const key of Object.keys(next) as Array<keyof DisplayStyle>) deleteStyle(next, key);
        break;
      case 1:
        next.bold = true;
        break;
      case 2:
        next.dimColor = true;
        break;
      case 3:
        next.italic = true;
        break;
      case 4:
        next.underline = true;
        break;
      case 7:
        next.inverse = true;
        break;
      case 9:
        next.strikethrough = true;
        break;
      case 22:
        deleteStyle(next, "bold");
        deleteStyle(next, "dimColor");
        break;
      case 23:
        deleteStyle(next, "italic");
        break;
      case 24:
        deleteStyle(next, "underline");
        break;
      case 27:
        deleteStyle(next, "inverse");
        break;
      case 29:
        deleteStyle(next, "strikethrough");
        break;
      case 39:
        deleteStyle(next, "color");
        break;
      case 49:
        deleteStyle(next, "backgroundColor");
        break;
      case 38:
      case 48: {
        const mode = parameters[index + 1];
        const property = code === 38 ? "color" : "backgroundColor";
        if (mode === 5) {
          const value = parameters[index + 2];
          if (value !== undefined) next[property] = `ansi256(${value})`;
          index += 2;
        } else if (mode === 2) {
          const red = parameters[index + 2];
          const green = parameters[index + 3];
          const blue = parameters[index + 4];
          if (red !== undefined && green !== undefined && blue !== undefined) {
            next[property] = `rgb(${red}, ${green}, ${blue})`;
          }
          index += 4;
        } else {
          // Unknown extended-color form: skip its mode argument, if present.
          index += 1;
        }
        break;
      }
      default: {
        const color = FOREGROUND_COLORS[code];
        if (color !== undefined) next.color = color;
        if (code >= 40 && code <= 47) {
          const background = FOREGROUND_COLORS[code - 10];
          if (background !== undefined) next.backgroundColor = background;
        }
        if (code >= 100 && code <= 107) {
          const background = FOREGROUND_COLORS[code - 60];
          if (background !== undefined) next.backgroundColor = background;
        }
        break;
      }
    }
  }
  return next;
}

function isSgr(sequence: string): boolean {
  return SGR_RE.test(sequence);
}

function appendPlainTokens(
  tokens: DisplayToken[],
  text: string,
  style: DisplayStyle,
): void {
  if (text === "") return;
  for (const { segment } of segmenter.segment(text)) {
    tokens.push({ value: segment, width: stringWidth(segment), style: cloneStyle(style) });
  }
}

/**
 * Split ANSI-bearing text into grapheme tokens. Non-SGR escape sequences are
 * discarded, while SGR sequences update the state attached to subsequent
 * graphemes. This deliberately does not retain the original control bytes.
 */
function tokenize(text: string): DisplayToken[] {
  const tokens: DisplayToken[] = [];
  const escapes = ansiRegex();
  let style: DisplayStyle = {};
  let index = 0;

  while (index < text.length) {
    escapes.lastIndex = index;
    const match = escapes.exec(text);
    if (match === null || match.index > index) {
      const end = match?.index ?? text.length;
      appendPlainTokens(tokens, text.slice(index, end), style);
      if (match === null) break;
    }

    if (match === null) break;
    const sequence = match[0];
    if (isSgr(sequence)) style = applySgr(style, sequence);
    index = match.index + sequence.length;
  }

  return tokens;
}

function fitTokens(tokens: readonly DisplayToken[], width: number): DisplayToken[] {
  const fitted: DisplayToken[] = [];
  let column = 0;
  for (const token of tokens) {
    if (token.width === 0) {
      // Keep combining/formatting clusters attached to the current column.
      fitted.push({ ...token, style: cloneStyle(token.style) });
      continue;
    }
    const tokenWidth = Math.max(1, token.width);
    if (column + tokenWidth > width) break;
    fitted.push({ ...token, width: tokenWidth, style: cloneStyle(token.style) });
    column += tokenWidth;
  }
  return fitted;
}

function assemble(tokens: readonly DisplayToken[], width: number): DisplayLine {
  const target = Math.max(0, Math.trunc(width));
  const cells: DisplayCell[] = [];
  let column = 0;

  for (const token of fitTokens(tokens, target)) {
    const tokenWidth = Math.max(0, token.width);
    cells.push({ value: token.value, width: tokenWidth, column, style: cloneStyle(token.style) });
    column += tokenWidth;
  }

  // A normalized line has an exact display width. Padding is deliberately
  // unstyled so a trailing ANSI color state cannot bleed into card borders.
  while (column < target) {
    cells.push({ value: " ", width: 1, column, style: {} });
    column++;
  }

  return {
    text: cells.map((cell) => cell.value).join(""),
    cells,
    width: target,
  };
}

/** Parse text (including ANSI SGR) and normalize it to an exact display width. */
export function makeDisplayLine(text: string, width: number): DisplayLine {
  return assemble(tokenize(text), width);
}

/** A line of spaces with the requested terminal width. */
export function blankDisplayLine(width: number): DisplayLine {
  return assemble([], width);
}

/** Pad or clip an already normalized line by display columns, not JS indexes. */
export function padDisplayLine(line: DisplayLine, width: number): DisplayLine {
  return assemble(
    line.cells.map((cell) => ({ value: cell.value, width: cell.width, style: cell.style })),
    width,
  );
}

/** Join normalized pieces, re-flowing their cell positions to one exact line. */
export function joinDisplayLines(parts: readonly DisplayLine[], width: number): DisplayLine {
  return assemble(
    parts.flatMap((part) =>
      part.cells.map((cell) => ({ value: cell.value, width: cell.width, style: cell.style })),
    ),
    width,
  );
}

/** Truncate to a display width and append an ellipsis when necessary. */
export function truncateDisplayLine(text: string, width: number, ellipsis = "…"): DisplayLine {
  const target = Math.max(0, Math.trunc(width));
  if (displayWidth(text) <= target) return makeDisplayLine(text, target);
  if (target === 0) return blankDisplayLine(0);

  const markerWidth = Math.max(1, displayWidth(ellipsis));
  const prefixWidth = Math.max(0, target - markerWidth);
  const prefix = fitTokens(tokenize(text), prefixWidth);
  const marker: DisplayToken = { value: ellipsis, width: markerWidth, style: {} };
  return assemble([...prefix, marker], target);
}

/** Return the visible text intersecting an inclusive display-column range. */
export function sliceDisplayLine(line: DisplayLine, left: number, right: number): string {
  const start = Math.max(0, Math.trunc(left));
  const end = Math.max(start - 1, Math.trunc(right));
  if (end < start) return "";

  const values: string[] = [];
  for (const cell of line.cells) {
    if (cell.width === 0) {
      if (cell.column >= start && cell.column <= end) values.push(cell.value);
      continue;
    }
    const cellEnd = cell.column + cell.width - 1;
    // A wide grapheme is indivisible: selecting either occupied column copies
    // the complete grapheme rather than emitting half of a surrogate/cluster.
    if (cell.column <= end && cellEnd >= start) values.push(cell.value);
  }
  return values.join("");
}

/** Compare two style snapshots for run coalescing in the renderer. */
export function sameDisplayStyle(a: DisplayStyle, b: DisplayStyle): boolean {
  return (
    a.bold === b.bold &&
    a.dimColor === b.dimColor &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse &&
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor
  );
}
