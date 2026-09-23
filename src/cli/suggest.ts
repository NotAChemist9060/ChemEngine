/** Levenshtein distance — used for friendly unknown-command hints. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev: number[] = Array.from({ length: cols }, (_, j) => j);
  let curr: number[] = new Array(cols);
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[cols - 1]!;
}

/** Closest candidate by edit distance, when it's within a reasonable tolerance. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  const query = input.toLowerCase();
  let best: { name: string; d: number } | undefined;
  for (const c of candidates) {
    const d = editDistance(query, c);
    if (!best || d < best.d) best = { name: c, d };
  }
  const dist = best?.d ?? Infinity;
  if (dist > 0 && dist <= Math.max(2, Math.floor(query.length / 2))) return best!.name;
  return undefined;
}