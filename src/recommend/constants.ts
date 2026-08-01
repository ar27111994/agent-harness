import type { HostTarget } from "../types.js";

/**
 * Defines the legacy policy file path location used by persisted project state.
 */
export const LEGACY_POLICY_FILE_PATH = [
  "discover",
  "recommendation-policy.json",
] as const;
/**
 * Defines the policy base file path location used by persisted project state.
 */
export const POLICY_BASE_FILE_PATH = [
  "discover",
  "recommendation-policy",
  "base.json",
] as const;
/**
 * Defines the policy host directory path location used by persisted project state.
 */
export const POLICY_HOST_DIRECTORY_PATH = [
  "discover",
  "recommendation-policy",
  "hosts",
] as const;
/**
 * Defines the user-owned policy base override path location used by persisted project state.
 */
export const POLICY_OVERRIDE_BASE_FILE_PATH = [
  "discover",
  "recommendation-policy",
  "overrides",
  "base.json",
] as const;
/**
 * Defines the user-owned policy host override directory path location used by persisted project state.
 */
export const POLICY_OVERRIDE_HOST_DIRECTORY_PATH = [
  "discover",
  "recommendation-policy",
  "overrides",
  "hosts",
] as const;
/**
 * Defines the report file path location used by persisted project state.
 */
export const REPORT_FILE_PATH = ["state", "recommendations.json"] as const;
/**
 * Defines the evaluation file path location used by persisted project state.
 */
export const EVALUATION_FILE_PATH = [
  "state",
  "recommendation-evaluation.json",
] as const;
/**
 * Defines shared recommendation host shared by the lifecycle pipeline.
 */
export const SHARED_RECOMMENDATION_HOST =
  "shared" as const satisfies HostTarget;
// Cap each focused capability bucket so broad sources cannot crowd out
// diversity-sensitive recommendations before host policy caps are applied.
/**
 * Defines focused bucket limit shared by the lifecycle pipeline.
 */
export const FOCUSED_BUCKET_LIMIT = 20;
/**
 * Defines the minimum preselection pool size shared by recommendation selection.
 */
export const HOST_PRESELECTION_MIN_LIMIT = 250;
/**
 * Defines the multiplier from recommendation limit to preselection pool size.
 */
export const HOST_PRESELECTION_LIMIT_MULTIPLIER = 3;
/**
 * Defines the activation-budget divisor used for high-cost penalties.
 */
export const HIGH_COST_BUDGET_DIVISOR = 3;
/**
 * Defines the divisor used to convert prompt weight into a budget penalty.
 */
export const HIGH_COST_PENALTY_DIVISOR = 2;
/**
 * Defines the minimum non-zero budget penalty.
 */
export const MIN_BUDGET_PENALTY = 1;
/**
 * Defines the maximum coverage overlap counted per tag.
 */
export const COVERAGE_OVERLAP_CAP = 2;
/**
 * Defines the preselection weight assigned to each coverage tag match.
 */
export const COVERAGE_TAG_PRESELECTION_WEIGHT = 4;
/**
 * Minimum fraction of total score that coverage gain must represent
 * before a candidate is tagged with "coverage-gap-fill" (#354).
 */
export const COVERAGE_GAP_FILL_THRESHOLD = 0.1;
/**
 * Defines the duplicate-group overlap multiplier used in redundancy scoring.
 */
export const DUPLICATE_GROUP_OVERLAP_MULTIPLIER = 2;
/**
 * Defines generic capability terms shared by the lifecycle pipeline.
 */
export const GENERIC_CAPABILITY_TERMS = new Set([
  "agent",
  "agents",
  "ai",
  "code",
  "developer",
  "development",
  "everything",
  "first",
  "guide",
  "harness",
  "llm",
  "productivity",
  "research",
  "skill",
  "system",
  "tool",
  "tools",
]);

/**
 * Per-signal trust-score boosts applied during catalog entry construction.
 * Re-exported from the shared ARD module to avoid duplication.
 */
export { TRUST_SIGNAL_SCORE_BOOST } from "../ard/types.js";

/**
 * Default values for every field in RecommendationScoreBreakdown.
 *
 * New score-breakdown fields added to the type system need ONLY to be added
 * here — backward-compat injection is automatic.  This eliminates the
 * per-field `=== undefined` pattern that previously required a manual
 * injection line in assertRecommendationScoreBreakdown for every new field.
 *
 * All additive score components default to 0 (no contribution).
 * All penalty components default to 0 (no deduction).
 * The `total` field defaults to 0 (will be recomputed).
 */
export const SCORE_BREAKDOWN_DEFAULTS: Readonly<Record<string, number>> =
  Object.freeze({
    authority: 0,
    compatibility: 0,
    portfolioFit: 0,
    trust: 0,
    sourcePriority: 0,
    demand: 0,
    hostPreference: 0,
    coverage: 0,
    diversity: 0,
    assetKindDiversityPenalty: 0,
    freshness: 0,
    costPenalty: 0,
    riskPenalty: 0,
    negativePenalty: 0,
    ecosystemMismatchPenalty: 0,
    redundancyPenalty: 0,
    budgetPenalty: 0,
    total: 0,
  });
