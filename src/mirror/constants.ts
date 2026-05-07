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
 * Defines max official index package files shared by the lifecycle pipeline.
 */
export const MAX_OFFICIAL_INDEX_PACKAGE_FILES = 1_000;
/**
 * Defines max official index file size bytes shared by the lifecycle pipeline.
 */
export const MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES = 1_000_000;
/**
 * Defines max official index package total bytes shared by the lifecycle pipeline.
 */
export const MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES = 20_000_000;
/**
 * Defines max github mirror file size bytes shared by the lifecycle pipeline.
 */
export const MAX_GITHUB_MIRROR_FILE_SIZE_BYTES = 1_000_000;
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
