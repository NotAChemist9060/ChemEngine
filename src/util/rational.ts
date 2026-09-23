/**
 * Exact rational arithmetic on BigInt. Always reduced to lowest terms with a
 * positive denominator — the foundation for exact equation balancing.
 */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint; // always > 0
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a / gcd(a, b)) * b;
}

/** Build a rational from BigInts (or integer Numbers). Fractions are reduced automatically. */
export function rat(num: bigint | number, den: bigint | number = 1n): Rational {
  let n = typeof num === "number" ? BigInt(Math.trunc(num)) : num;
  let d = typeof den === "number" ? BigInt(Math.trunc(den)) : den;
  if (d === 0n) throw new Error("rational: division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  if (g === 0n) return { num: 0n, den: 1n };
  return { num: n / g, den: d / g };
}

/** Parse a decimal string such as "0.5", "-1.25", "3" into an exact rational. */
export function ratFromDecimal(input: string): Rational {
  const s = input.trim();
  const m = /^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))$/.exec(s);
  if (!m) throw new Error(`rational: invalid decimal '${input}'`);
  const sign = m[1] === "-" ? -1n : 1n;
  const intPart = m[2] ?? "0";
  const fracPart = m[3] ?? m[4] ?? "";
  const num = BigInt(intPart + fracPart);
  const den = fracPart.length > 0 ? 10n ** BigInt(fracPart.length) : 1n;
  return rat(sign * num, den);
}

export function ratAdd(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function ratSub(a: Rational, b: Rational): Rational {
  return ratAdd(a, ratNeg(b));
}

export function ratMul(a: Rational, b: Rational): Rational {
  return rat(a.num * b.num, a.den * b.den);
}

export function ratDiv(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new Error("rational: division by zero");
  return ratMul(a, { num: b.den, den: b.num });
}

export function ratNeg(a: Rational): Rational {
  return { num: -a.num, den: a.den };
}

export function ratInv(a: Rational): Rational {
  if (a.num === 0n) throw new Error("rational: division by zero");
  return rat(a.den, a.num);
}

export function ratAbs(a: Rational): Rational {
  return a.num < 0n ? ratNeg(a) : a;
}

export function ratIsZero(a: Rational): boolean {
  return a.num === 0n;
}

export function ratEq(a: Rational, b: Rational): boolean {
  return a.num === b.num && a.den === b.den;
}

/** -1, 0, or 1 */
export function ratCompare(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function ratToNumber(a: Rational): number {
  return Number(a.num) / Number(a.den);
}

export function ratToString(a: Rational): string {
  return a.den === 1n ? a.num.toString() : `${a.num}/${a.den}`;
}

/**
 * Scale a list of rationals to the smallest integer multiples.
 * Used by the balancer to turn a rational solution into integer coefficients.
 * Returns BigInts; throw if any value is zero.
 */
export function ratScaleToInts(values: Rational[]): bigint[] {
  let l = 1n;
  for (const v of values) l = lcm(l, v.den);
  const nums = values.map((v) => v.num * (l / v.den));
  let g = 0n;
  for (const n of nums) g = gcd(g, n);
  const scale = g > 1n ? g : 1n;
  return nums.map((n) => n / scale);
}