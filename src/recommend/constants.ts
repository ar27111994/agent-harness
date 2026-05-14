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
