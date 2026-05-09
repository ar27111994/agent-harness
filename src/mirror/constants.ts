import { getRuntimeConfig } from "../config/runtime.js";

/**
 * Defines the mirror plan output path location used by persisted project state.
 */
export const MIRROR_PLAN_OUTPUT_PATH = ["mirror", "audit", "mirror-plan.json"];
/**
 * Defines the mirror index output path location used by persisted project state.
 */
export const MIRROR_INDEX_OUTPUT_PATH = ["mirror", "index.jsonl"];
/**
 * Defines the mirror index snapshot path location used by persisted project state.
 */
export const MIRROR_INDEX_SNAPSHOT_PATH = ["mirror", "index.previous.jsonl"];
/**
 * Defines the mirror acquire state output path location used by persisted project state.
 */
export const MIRROR_ACQUIRE_STATE_OUTPUT_PATH = [
  "state",
  "mirror",
  "acquire-state.json",
];
/**
 * Returns max official index package files shared by the lifecycle pipeline.
 */
export function getMaxOfficialIndexPackageFiles(): number {
  return getRuntimeConfig().mirrorLimits.maxOfficialIndexPackageFiles;
}
/**
 * Returns max official index file size bytes shared by the lifecycle pipeline.
 */
export function getMaxOfficialIndexFileSizeBytes(): number {
  return getRuntimeConfig().mirrorLimits.maxOfficialIndexFileSizeBytes;
}
/**
 * Returns max official index package total bytes shared by the lifecycle pipeline.
 */
export function getMaxOfficialIndexPackageTotalBytes(): number {
  return getRuntimeConfig().mirrorLimits.maxOfficialIndexPackageTotalBytes;
}
/**
 * Returns max github mirror file size bytes shared by the lifecycle pipeline.
 */
export function getMaxGitHubMirrorFileSizeBytes(): number {
  return getRuntimeConfig().mirrorLimits.maxGitHubMirrorFileSizeBytes;
}
/**
 * Defines the allowed github raw allowed origins used by guarded network requests.
 */
export const GITHUB_RAW_ALLOWED_ORIGINS = [
  "https://raw.githubusercontent.com",
] as const;
/**
 * Defines the allowed github api allowed origins used by guarded network requests.
 */
export const GITHUB_API_ALLOWED_ORIGINS = ["https://api.github.com"] as const;
