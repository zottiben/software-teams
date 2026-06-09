/**
 * Levenshtein edit-distance utility.
 *
 * Pure function with no external dependencies. Used by the component resolver
 * to suggest the closest known name when a lookup fails.
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * @example
 * levenshtein("Verfy", "Verify") // 1
 * levenshtein("AgentBase", "AgentBas") // 1
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 +
          Math.min(
            dp[i - 1][j], // deletion
            dp[i][j - 1], // insertion
            dp[i - 1][j - 1], // substitution
          );
      }
    }
  }

  return dp[m][n];
}

/**
 * Return the candidate from `pool` with the lowest Levenshtein distance to
 * `query`. Returns `undefined` when `pool` is empty.
 *
 * @example
 * closestMatch("Verfy", ["Verify", "AgentBase"]) // "Verify"
 */
export function closestMatch(
  query: string,
  pool: readonly string[],
): string | undefined {
  if (pool.length === 0) return undefined;

  let best = pool[0];
  let bestDist = levenshtein(query, pool[0]);

  for (let i = 1; i < pool.length; i++) {
    const dist = levenshtein(query, pool[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = pool[i];
    }
  }

  return best;
}
