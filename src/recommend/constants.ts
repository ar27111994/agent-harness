import type { HostTarget } from "../types.js";

export const LEGACY_POLICY_FILE_PATH = [
  "discover",
  "recommendation-policy.json",
] as const;
export const POLICY_BASE_FILE_PATH = [
  "discover",
  "recommendation-policy",
  "base.json",
] as const;
export const POLICY_HOST_DIRECTORY_PATH = [
  "discover",
  "recommendation-policy",
  "hosts",
] as const;
export const REPORT_FILE_PATH = ["state", "recommendations.json"] as const;
export const EVALUATION_FILE_PATH = [
  "state",
  "recommendation-evaluation.json",
] as const;
export const SHARED_RECOMMENDATION_HOST =
  "shared" as const satisfies HostTarget;
// Cap each focused capability bucket so broad sources cannot crowd out
// diversity-sensitive recommendations before host policy caps are applied.
export const FOCUSED_BUCKET_LIMIT = 20;
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
