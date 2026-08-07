/**
 * activate/selection — activation candidate selection core (#435).
 *
 * Extracted from activate.ts: the pure decision logic that turns installed
 * bundle candidates into a selected activation set — per-host budgets,
 * preferred asset order, intention matching, negative-score hard boundary
 * (#426), concern/task-mode buckets, and the ranking comparators. No I/O:
 * the state flows that call these live in activate.ts.
 */

import type {
  HostTarget,
  InstalledPackageManifest,
  RecommendationEntry,
  RecommendationReport,
  SessionIntent,
} from "../types.js";
import { recommendationMatchesSessionIntent } from "../lib/session-intent.js";

/**
 * Hosts that activation can directly materialize runtime views for.
 */
export type ActivationHost = "opencode" | "copilot-vscode" | "shared";

/**
 * The ordered list of activation-capable hosts.
 */
export const ACTIVATION_HOSTS = [
  "opencode",
  "copilot-vscode",
  "shared",
] as const satisfies readonly ActivationHost[];

/**
 * Canonical host target for the shared/default activation scope.
 */
export const SHARED_HOST_TARGET = "shared" as const satisfies HostTarget;

/**
 * Maximum character length of a generated Copilot workspace profile ID.
 * IDs are derived by joining asset IDs with hyphens and stripping non-slug
 * characters; truncating at 96 characters keeps them within settings-file
 * limits while remaining unique for practical asset sets.
 */
const COPILOT_PROFILE_ID_MAX_LENGTH = 96;

/**
 * Number of asset ID segments joined before the profile ID is truncated.
 * Using the first 12 IDs balances uniqueness against ID length; longer
 * lists produce IDs that are indistinguishable after truncation anyway.
 */
const COPILOT_PROFILE_ID_ASSET_SEGMENT_COUNT = 12;

/**
 * Per-host activation budgets — maximum number of assets selected for
 * the runtime activation manifest on each host.
 *
 * Copilot VS Code: 60 — bounded by the Copilot chat context window.
 * OpenCode:       120 — larger context tolerance allows a bigger set.
 * Default/shared:  40 — conservative floor for hosts with unknown limits.
 */
const COPILOT_VSCODE_ACTIVATION_BUDGET = 60;
const OPENCODE_ACTIVATION_BUDGET = 120;
const DEFAULT_ACTIVATION_BUDGET = 40;

/**
 * Maximum number of assets placed in the "focused" activation bucket.
 * The focused bucket contains the highest-priority intent-matched assets.
 * Capping at 20 ensures that a single session intent cannot crowd out the
 * broader set when both buckets are merged.
 */
const FOCUSED_ACTIVATION_BUCKET_MAX_SIZE = 20;

/**
 * Filters installed bundle ids down to those a host's recommendation report
 * suggests. When the report has no suggestion for the host (or none of the
 * suggestions survive the filter), every bundle id is kept — catalog
 * selection breadth remains the operator-curated contract.
 */
export function filterBundleIdsForHost(
  bundleIds: string[],
  host: HostTarget,
  recommendationReport: RecommendationReport | null,
): string[] {
  const suggestedBundleIds = new Set(
    (recommendationReport?.suggestedBundles ?? [])
      .filter((bundle) => bundle.host === host)
      .map((bundle) => bundle.bundleId),
  );

  if (suggestedBundleIds.size === 0) {
    return bundleIds;
  }

  const filteredBundleIds = bundleIds.filter((bundleId) =>
    suggestedBundleIds.has(bundleId),
  );
  return filteredBundleIds.length > 0 ? filteredBundleIds : bundleIds;
}

/**
 * Returns the default bundle ids activated for a host when no explicit host
 * bundle list is configured.
 */
export function getDefaultBundleIdsForHost(host: ActivationHost): string[] {
  if (host === "opencode") {
    return ["opencode-global", "community-stable"];
  }

  if (host === "copilot-vscode") {
    return ["copilot-core", "community-stable"];
  }

  return ["shared-mcp"];
}

/**
 * Builds a deterministic, slug-safe Copilot workspace profile id from
 * selected asset ids: the first segments joined with hyphens, non-slug
 * characters collapsed, and the result capped at a safe ID length.
 */
export function buildCopilotProfileId(assetIds: string[]): string {
  return assetIds
    .slice(0, COPILOT_PROFILE_ID_ASSET_SEGMENT_COUNT)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .slice(0, COPILOT_PROFILE_ID_MAX_LENGTH);
}

const ACTIVATION_BUDGET_BY_HOST = new Map<ActivationHost, number>([
  ["copilot-vscode", COPILOT_VSCODE_ACTIVATION_BUDGET],
  ["opencode", OPENCODE_ACTIVATION_BUDGET],
]);

/**
 * Returns the per-host activation budget, falling back to the conservative
 * default for hosts without an explicit budget.
 */
export function getActivationBudget(host: ActivationHost): number {
  return ACTIVATION_BUDGET_BY_HOST.get(host) ?? DEFAULT_ACTIVATION_BUDGET;
}

/**
 * Comparator ranking activation candidates: session-intent match first, then
 * recommendation order, source authority, portfolio fit, context cost, and
 * finally a deterministic asset-id tie-break.
 *
 * @returns A negative, zero, or positive number per Array.sort semantics.
 */
export function compareActivationCandidates(
  left: InstalledPackageManifest,
  right: InstalledPackageManifest,
  preferredAssetOrder: Map<string, number>,
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
  sessionIntent: SessionIntent,
): number {
  const intentDifference =
    getSessionIntentMatchRank(
      recommendationEntryByAssetId.get(right.assetId),
      sessionIntent,
    ) -
    getSessionIntentMatchRank(
      recommendationEntryByAssetId.get(left.assetId),
      sessionIntent,
    );
  if (intentDifference !== 0) {
    return intentDifference;
  }

  const recommendedOrderDifference =
    getRecommendationOrder(left.assetId, preferredAssetOrder) -
    getRecommendationOrder(right.assetId, preferredAssetOrder);
  if (recommendedOrderDifference !== 0) {
    return recommendedOrderDifference;
  }

  const authorityDifference =
    getAuthorityRank(right.sourceAuthorityTier) -
    getAuthorityRank(left.sourceAuthorityTier);
  if (authorityDifference !== 0) {
    return authorityDifference;
  }

  const portfolioFitDifference = right.portfolioFit - left.portfolioFit;
  if (portfolioFitDifference !== 0) {
    return portfolioFitDifference;
  }

  const contextCostDifference =
    getContextCostRank(left.contextCost.sizeClass) -
    getContextCostRank(right.contextCost.sizeClass);
  if (contextCostDifference !== 0) {
    return contextCostDifference;
  }

  return left.assetId.localeCompare(right.assetId);
}

/**
 * Selects activation candidates up to the budget: negatively scored assets
 * are never selected (hard boundary #426), and prompt-weight accounting
 * guarantees the first candidate always fits the remaining budget.
 */
export function selectActivationCandidates(
  candidates: Array<{
    packageManifest: InstalledPackageManifest;
    destinationRoot: string;
  }>,
  preferredAssetOrder: Map<string, number>,
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
  activationBudget: number,
  sessionIntent: SessionIntent,
): Array<{
  packageManifest: InstalledPackageManifest;
  destinationRoot: string;
}> {
  const sortedCandidates = [...candidates].sort((left, right) =>
    compareActivationCandidates(
      left.packageManifest,
      right.packageManifest,
      preferredAssetOrder,
      recommendationEntryByAssetId,
      sessionIntent,
    ),
  );
  const selectedCandidates: Array<{
    packageManifest: InstalledPackageManifest;
    destinationRoot: string;
  }> = [];
  let remainingBudget = activationBudget;

  for (const candidate of sortedCandidates) {
    const recommendedEntry = recommendationEntryByAssetId.get(
      candidate.packageManifest.assetId,
    );
    // Hard boundary (#426): an asset with a NEGATIVE recommendation score for
    // the activation's recommendation host is never selected — the engine
    // explicitly marked it a don't-use for this context, and a supply-chain
    // tool must not let a negatively-scored asset become active. Assets with
    // NO recommendation for the host remain eligible: staged-bundle breadth
    // is the operator-curated contract (mirror locks + catalog selection),
    // but they rank below recommended assets via preferredAssetOrder.
    if (isNegativelyScored(recommendedEntry)) {
      continue;
    }
    const promptWeight =
      recommendedEntry?.estimatedPromptWeight ??
      candidate.packageManifest.contextCost.estimatedPromptWeight;

    if (promptWeight <= remainingBudget || selectedCandidates.length === 0) {
      selectedCandidates.push(candidate);
      remainingBudget -= promptWeight;
    }
  }

  return selectedCandidates;
}

/**
 * Groups asset ids by their recommendation coverage tags (concerns), with
 * each bucket deduplicated and sorted.
 */
export function buildConcernBuckets(
  assetIds: string[],
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const assetId of assetIds) {
    const recommendationEntry = recommendationEntryByAssetId.get(assetId);
    if (!recommendationEntry) {
      continue;
    }
    for (const tag of recommendationEntry.coverageTags) {
      const bucket = buckets.get(tag) ?? [];
      bucket.push(assetId);
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

/**
 * Groups asset ids by task mode and appends the intent-ranked "focused"
 * bucket (capped) plus the full "broad" bucket used to shape activation
 * ordering.
 */
export function buildTaskModeBuckets(
  assetIds: string[],
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
  sessionIntent: SessionIntent,
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const assetId of assetIds) {
    const recommendationEntry = recommendationEntryByAssetId.get(assetId);
    if (!recommendationEntry) {
      continue;
    }
    for (const taskMode of recommendationEntry.taskModes) {
      const bucket = buckets.get(taskMode) ?? [];
      bucket.push(assetId);
      buckets.set(taskMode, bucket);
    }
  }

  const originalOrder = new Map(
    assetIds.map((assetId, index) => [assetId, index] as const),
  );
  const focusedAssetIds = [...assetIds].sort((left, right) => {
    const intentDifference =
      getSessionIntentMatchRank(
        recommendationEntryByAssetId.get(right),
        sessionIntent,
      ) -
      getSessionIntentMatchRank(
        recommendationEntryByAssetId.get(left),
        sessionIntent,
      );
    if (intentDifference !== 0) {
      return intentDifference;
    }

    return (
      getRecommendationOrder(left, originalOrder) -
      getRecommendationOrder(right, originalOrder)
    );
  });

  buckets.set(
    "focused",
    focusedAssetIds.slice(
      0,
      Math.min(FOCUSED_ACTIVATION_BUCKET_MAX_SIZE, focusedAssetIds.length),
    ),
  );
  buckets.set("broad", [...assetIds]);

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
}

/**
 * Hard negative-score boundary shared by every activation selection path
 * (#426): an asset the recommendation engine scored below zero for a host
 * can never be activated for it. Centralizing the predicate keeps the
 * selection, fallback-pool, and explain paths on one definition of the
 * boundary.
 */
export function isNegativelyScored(
  recommendationEntry: { score: number | undefined } | undefined | null,
): boolean {
  return (
    recommendationEntry !== undefined &&
    recommendationEntry !== null &&
    recommendationEntry.score !== undefined &&
    recommendationEntry.score < 0
  );
}

function getSessionIntentMatchRank(
  recommendationEntry: RecommendationEntry | undefined,
  sessionIntent: SessionIntent,
): number {
  return recommendationEntry &&
    recommendationMatchesSessionIntent({
      intent: sessionIntent,
      coverageTags: recommendationEntry.coverageTags,
      taskModes: recommendationEntry.taskModes,
    })
    ? 1
    : 0;
}

function getRecommendationOrder(
  assetId: string,
  preferredAssetOrder: Map<string, number>,
): number {
  return preferredAssetOrder.get(assetId) ?? Number.MAX_SAFE_INTEGER;
}

function getAuthorityRank(
  authorityTier: InstalledPackageManifest["sourceAuthorityTier"],
): number {
  const ranks: Record<InstalledPackageManifest["sourceAuthorityTier"], number> =
    {
      "official-first-party": 6,
      "official-marketplace": 5,
      "official-compatible": 4,
      "trusted-local": 3,
      "trusted-community": 2,
      "unverified-community": 1,
    };

  return ranks[authorityTier];
}

function getContextCostRank(
  sizeClass: InstalledPackageManifest["contextCost"]["sizeClass"],
): number {
  const ranks: Record<
    InstalledPackageManifest["contextCost"]["sizeClass"],
    number
  > = {
    tiny: 1,
    small: 2,
    medium: 3,
    large: 4,
  };

  return ranks[sizeClass];
}
