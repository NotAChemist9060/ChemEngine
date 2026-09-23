/**
 * Dimensional analysis for concentration quantities: amount (mol), volume (L),
 * time (s). Rate constants carry units determined by the reaction order, e.g.
 * a second-order step requires L·mol⁻¹·s⁻¹. All quantities parse/validate these
 * dimensions; no silent unit bugs.
 */
export interface Dim {
  readonly mol: number;
  readonly L: number;
  readonly s: number;
}

const ZERO: Dim = { mol: 0, L: 0, s: 0 };

export const DIM = {
  none: ZERO,
  molar: { mol: 1, L: -1, s: 0 }, // mol/L — a concentration
  perSecond: { mol: 0, L: 0, s: -1 },
} as const;

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
};

const DIGIT_SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

function normalizeSuperscripts(s: string): string {
  return s.split("").map((ch) => SUPERSCRIPT_DIGITS[ch] ?? ch).join("");
}

export function sameDim(a: Dim, b: Dim): boolean {
  return a.mol === b.mol && a.L === b.L && a.s === b.s;
}

export function mulDim(a: Dim, b: Dim): Dim {
  return { mol: a.mol + b.mol, L: a.L + b.L, s: a.s + b.s };
}

export function divDim(a: Dim, b: Dim): Dim {
  return { mol: a.mol - b.mol, L: a.L - b.L, s: a.s - b.s };
}

export function powDim(a: Dim, n: number): Dim {
  return { mol: a.mol * n, L: a.L * n, s: a.s * n };
}

/** Unit dimension required for a rate constant of a step of order `order`. */
export function unitForOrder(order: number): Dim {
  return { mol: 1 - order, L: order - 1, s: -1 };
}

function tokenDim(raw: string): Dim {
  const token = normalizeSuperscripts(raw.trim());
  if (token === "" || token === "1") return ZERO;
  if (token === "M") return DIM.molar;
  const m = /^([A-Za-z]+)(?:\^?(-?\d+))?$/.exec(token);
  if (!m) throw new Error(`units: unrecognized unit token '${raw}'`);
  const symbol = m[1]!.toLowerCase();
  const exp = m[2] !== undefined ? parseInt(m[2], 10) : 1;
  switch (symbol) {
    case "mol": return { mol: exp, L: 0, s: 0 };
    case "l":
    case "liter":
    case "litre": return { mol: 0, L: exp, s: 0 };
    case "s":
    case "sec":
    case "second": return { mol: 0, L: 0, s: exp };
    default: throw new Error(`units: unrecognized unit token '${raw}'`);
  }
}

function splitTerms(s: string): string[] {
  return s.split(/[·*\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
}

/**
 * Parse a unit expression into a dimension. Supports '·'/'*' for products,
 * '/' for division, '^' or unicode superscripts for powers, and 'M' for mol/L.
 * Examples: "L·mol⁻¹·s⁻¹", "L/mol/s", "1/(M·s)", "s⁻¹", "M".
 */
export function parseDim(input: string): Dim {
  const s = normalizeSuperscripts(input.trim().replace(/[()]/g, ""));
  if (s === "" || s === "1") return ZERO;
  const parts = s.split("/");
  let dim: Dim = ZERO;
  for (const tok of splitTerms(parts[0]!)) dim = mulDim(dim, tokenDim(tok));
  for (let i = 1; i < parts.length; i++) {
    for (const tok of splitTerms(parts[i]!)) dim = divDim(dim, tokenDim(tok));
  }
  return dim;
}

function exponentString(n: number): string {
  if (n === 1) return "";
  const sign = n < 0 ? "⁻" : "";
  return (
    sign +
    Math.abs(n)
      .toString()
      .split("")
      .map((ch) => DIGIT_SUPERSCRIPTS[ch] ?? ch)
      .join("")
  );
}

/** Render a dimension canonically with superscripts, e.g. {L:1,mol:-1,s:-1} → "L·mol⁻¹·s⁻¹". */
export function formatDim(d: Dim): string {
  const parts: string[] = [];
  for (const [key, sym] of [["L", "L"], ["mol", "mol"], ["s", "s"]] as const) {
    const e = d[key];
    if (e !== 0) parts.push(sym + exponentString(e));
  }
  return parts.length > 0 ? parts.join("·") : "1";
}

export interface Quantity {
  value: number;
  dim: Dim;
}

/** Parse "10 M", "0.1 L·mol⁻¹·s⁻¹", "5" into a value + dimension. */
export function parseQuantity(input: string): Quantity {
  const m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/.exec(input.trim());
  if (!m) throw new Error(`units: invalid quantity '${input}'`);
  const value = parseFloat(m[1]!);
  const dim = parseDim(m[2] ?? "");
  return { value, dim };
}

export function formatQuantity(q: Quantity): string {
  return `${q.value} ${formatDim(q.dim)}`;
}