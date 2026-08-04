/**
 * Provides count coverage tags for the lifecycle pipeline.
 *
 * Single canonical coverage-tag counter (#438): previously exposed as a
 * generic private helper behind two thin middle-man wrappers
 * (countCoverageTags / countCoverageTagsFromEntries) that added no behavior.
 * Callers use this function directly, typed to any entry shape carrying
 * `coverageTags`.
 */
export function countCoverageTagsForItems<T extends { coverageTags: string[] }>(
  entries: T[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.coverageTags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Provides count by for the lifecycle pipeline.
 */
export function countBy<T>(
  values: T[],
  selector: (value: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = selector(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
