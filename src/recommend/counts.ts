import type { RecommendationEntry } from "../types.js";
import type { CandidateRecommendation } from "./model.js";

export function countCoverageTags(
  entries: CandidateRecommendation[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.coverageTags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

export function countCoverageTagsFromEntries(
  entries: RecommendationEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.coverageTags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

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
