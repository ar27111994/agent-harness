import { getRuntimeConfig } from "../config/runtime.js";
import { FOCUSED_BUCKET_LIMIT } from "./constants.js";
import { countBy, countCoverageTagsFromEntries } from "./counts.js";
import type {
  RecommendationEntry,
  RecommendationHostSummary,
  RecommendationPolicy,
  RecommendationSuggestedBundle,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";

/**
 * Builds host summary from the provided inputs.
 */
export function buildHostSummary(
  host: RecommendationHost,
  entries: RecommendationEntry[],
  policy: RecommendationPolicy,
): RecommendationHostSummary {
  const recommendationRuntime = getRuntimeConfig().recommendation;
  const limitOverride = recommendationRuntime.limitOverrides[host];
  const modeOverride = recommendationRuntime.limitOverrideModes[host];
  const hostPolicy = policy.hosts[host];

  return {
    host,
    recommendationLimit: hostPolicy.recommendationLimit,
    recommendationLimitSource: limitOverride ? "env" : "policy",
    recommendationLimitEnvVar: limitOverride?.envVar,
    recommendationLimitOverrideMode:
      hostPolicy.recommendationLimitOverrideMode ?? "preserve",
    recommendationLimitOverrideModeSource: modeOverride ? "env" : "policy",
    recommendationLimitOverrideModeEnvVar: modeOverride?.envVar,
    recommendationLimitScaleFactor:
      hostPolicy.recommendationLimitScaleFactor ?? undefined,
    recommendationLimitScaledFields:
      hostPolicy.recommendationLimitScaledFields ?? undefined,
    activationBudget: hostPolicy.activationBudget,
    selectedCount: entries.length,
    totalEstimatedPromptWeight: entries.reduce(
      (total, entry) => total + entry.estimatedPromptWeight,
      0,
    ),
    selectedAssetIds: entries.map((entry) => entry.assetId),
    byAssetKind: countBy(entries, (entry) => entry.assetKind ?? "unknown"),
    bySourceFamily: countBy(entries, (entry) => entry.sourceFamily),
    byConcern: countCoverageTagsFromEntries(entries),
    concernBuckets: buildConcernBuckets(entries),
    taskModeBuckets: buildTaskModeBuckets(entries),
  };
}

/**
 * Builds suggested bundle from the provided inputs.
 */
export function buildSuggestedBundle(
  host: RecommendationHost,
  entries: RecommendationEntry[],
  policy: RecommendationPolicy,
): RecommendationSuggestedBundle {
  const hostPolicy = policy.hosts[host];
  const selectedEntries = selectEntriesWithinBudget(
    entries,
    hostPolicy.activationBudget,
  );

  return {
    host,
    bundleId: hostPolicy.suggestedBundleId,
    assetIds: selectedEntries.map((entry) => entry.assetId),
    estimatedPromptWeight: selectedEntries.reduce(
      (total, entry) => total + entry.estimatedPromptWeight,
      0,
    ),
    concernBuckets: buildConcernBuckets(selectedEntries),
    taskModeBuckets: buildTaskModeBuckets(selectedEntries),
  };
}

function selectEntriesWithinBudget(
  entries: RecommendationEntry[],
  budget: number,
): RecommendationEntry[] {
  const selected: RecommendationEntry[] = [];
  let remainingBudget = budget;

  for (const entry of entries) {
    if (entry.estimatedPromptWeight <= remainingBudget) {
      selected.push(entry);
      remainingBudget -= entry.estimatedPromptWeight;
    }
  }

  return selected;
}

function buildConcernBuckets(
  entries: RecommendationEntry[],
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const entry of entries) {
    for (const tag of entry.coverageTags) {
      const bucket = buckets.get(tag) ?? [];
      bucket.push(entry.assetId);
      buckets.set(tag, bucket);
    }
  }

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
}

function buildTaskModeBuckets(
  entries: RecommendationEntry[],
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const entry of entries) {
    for (const taskMode of entry.taskModes) {
      const bucket = buckets.get(taskMode) ?? [];
      bucket.push(entry.assetId);
      buckets.set(taskMode, bucket);
    }
  }

  buckets.set(
    "focused",
    entries
      .slice(0, Math.min(FOCUSED_BUCKET_LIMIT, entries.length))
      .map((entry) => entry.assetId),
  );
  buckets.set(
    "broad",
    entries.map((entry) => entry.assetId),
  );

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
}
