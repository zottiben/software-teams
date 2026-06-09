export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  Array.from({ length: m }, (_, i) => i + 1).forEach((i) => {
    Array.from({ length: n }, (_, j) => j + 1).forEach((j) => {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    });
  });

  return dp[m][n];
}

export function closestMatch(
  query: string,
  pool: readonly string[],
): string | undefined {
  if (pool.length === 0) return undefined;

  return pool.reduce(
    (acc, candidate) => {
      const dist = levenshtein(query, candidate);
      return dist < acc.bestDist ? { best: candidate, bestDist: dist } : acc;
    },
    { best: pool[0], bestDist: levenshtein(query, pool[0]) },
  ).best;
}
