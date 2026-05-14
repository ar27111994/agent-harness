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
