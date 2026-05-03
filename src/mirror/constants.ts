export const MIRROR_PLAN_OUTPUT_PATH = ["mirror", "audit", "mirror-plan.json"];
export const MIRROR_INDEX_OUTPUT_PATH = ["mirror", "index.jsonl"];
export const MIRROR_INDEX_SNAPSHOT_PATH = ["mirror", "index.previous.jsonl"];
export const MIRROR_ACQUIRE_STATE_OUTPUT_PATH = [
  "state",
  "mirror",
  "acquire-state.json",
];
export const MAX_OFFICIAL_INDEX_PACKAGE_FILES = 50;
export const MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES = 150_000;
export const MAX_GITHUB_MIRROR_FILE_SIZE_BYTES = 500_000;
export const GITHUB_RAW_ALLOWED_ORIGINS = [
  "https://raw.githubusercontent.com",
] as const;
export const GITHUB_API_ALLOWED_ORIGINS = ["https://api.github.com"] as const;
