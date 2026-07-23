import { homedir } from "node:os";
import { join } from "node:path";

import type {
  AiEnrichmentMode,
  RecommendationLimitOverrideMode,
} from "../types.js";

const RECOMMENDATION_LIMIT_OVERRIDE_ENV_BY_HOST = {
  shared: "AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT",
  "copilot-vscode": "AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT",
  opencode: "AGENT_HARNESS_OPENCODE_RECOMMENDATION_LIMIT",
  cursor: "AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT",
  zed: "AGENT_HARNESS_ZED_RECOMMENDATION_LIMIT",
  "claude-code": "AGENT_HARNESS_CLAUDE_CODE_RECOMMENDATION_LIMIT",
  pi: "AGENT_HARNESS_PI_RECOMMENDATION_LIMIT",
} as const;

const RECOMMENDATION_LIMIT_OVERRIDE_MODE_ENV_BY_HOST = {
  shared: "AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT_MODE",
  "copilot-vscode": "AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE",
  opencode: "AGENT_HARNESS_OPENCODE_RECOMMENDATION_LIMIT_MODE",
  cursor: "AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT_MODE",
  zed: "AGENT_HARNESS_ZED_RECOMMENDATION_LIMIT_MODE",
  "claude-code": "AGENT_HARNESS_CLAUDE_CODE_RECOMMENDATION_LIMIT_MODE",
  pi: "AGENT_HARNESS_PI_RECOMMENDATION_LIMIT_MODE",
} as const;

const DEFAULT_AI_ENRICHMENT_MODEL = "gpt-4o-mini";
const RECOMMENDATION_LIMIT_OVERRIDE_MODES = [
  "preserve",
  "scale",
] as const satisfies readonly RecommendationLimitOverrideMode[];
const AI_ENRICHMENT_MODES = [
  "off",
  "manual",
  "after-select",
  "after-workspace",
  "on-ambiguity",
  "on-input-change",
  "ci-only",
] as const satisfies readonly AiEnrichmentMode[];
const DEFAULT_AI_ENRICHMENT_ALLOWED_ORIGINS = [
  "https://api.openai.com",
  "https://openrouter.ai",
  "https://api.groq.com",
  "https://api.mistral.ai",
  "https://api.deepseek.com",
  "https://api.x.ai",
  "https://api.perplexity.ai",
  "https://api.fireworks.ai",
  "https://api.together.xyz",
] as const;
const AI_ENRICHMENT_DEFAULTS = {
  requestTimeoutMs: 20_000,
  responseMaxBytes: 1_000_000,
  maxSelectedAssets: 50,
  maxEvidenceItems: 12,
  maxCapabilitiesPerAsset: 16,
  retryMaxAttempts: 1,
  retryBackoffMs: 1_000,
  autoMinIntervalMs: 300_000,
} as const;
const INSTALL_DEFAULTS = {
  refreshPolicy: "report-only",
  refreshIntervalMs: 21_600_000,
} as const;
const HTTP_DEFAULTS = {
  timeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
} as const;
const GITHUB_DEFAULTS = {
  apiVersion: "2022-11-28",
  fetchMaxAttempts: 3,
  fetchTimeoutMs: 10_000,
  jsonMaxBytes: 2_000_000,
} as const;
const REGISTRY_DEFAULTS = {
  fetchTimeoutMs: 5_000,
  metadataMaxBytes: 2_000_000,
  searchMaxBytes: 500_000,
  npmSearchResultLimit: 12,
} as const;
const DISCOVERY_DEFAULTS = {
  referenceSourceMaxBytes: 600_000,
  genericReferenceMaxItems: 8,
  vscodeMarketplaceMaxQueries: 4,
  vscodeMarketplaceMaxItemsPerQuery: 6,
  vscodeMarketplaceSyncPageSize: 50,
  /** Pages to fetch in the popularity-first sweep before alphabetical pagination. */
  vscodeMarketplacePopularitySweepPages: 50,
  /** Whether the category-taxonomy sweep is enabled. */
  vscodeMarketplaceCategorySweepEnabled: true,
  sourceSyncMaxPagesPerRun: 10,
  npmMcpSearchQueryLimit: 8,
  /**
   * Number of pages to paginate per source when running `discover index`
   * (the offline full-index build). 0 means unlimited — appropriate for a
   * scheduled full-index run. The default of 500 gives ~25,000 entries per
   * source at the typical 50-item page size.
   */
  sourceSyncMaxPagesForIndexBuild: 500,
  /**
   * Maximum age in days before the local catalog-index.jsonl is considered
   * stale and `discover sync` will trigger a live re-harvest instead of
   * using the cached index.
   */
  discoveryIndexMaxAgeDays: 7,
  /**
   * Whether semantic similarity scoring via @xenova/transformers is enabled.
   * When false (default) the existing keyword-overlap demand-relevance gate
   * is used. When true and the package is installed, cosine similarity
   * replaces the binary keyword gate and `fit.fitLevel` is populated.
   */
  semanticScoringEnabled: false,
  /**
   * Minimum cosine similarity (0–1) for an entry to pass the semantic
   * demand-relevance gate. Default 0.35 ("weak" fit threshold).
   * Ignored when semantic scoring is disabled.
   */
  semanticScoringMinSimilarity: 0.35,
  /**
   * Max search terms to dispatch per registry search sweep.
   * Default 10 matches the AC.
   */
  registrySearchMaxTerms: 10,
  /**
   * Max results per registry search term. Default 50 per AC.
   */
  registrySearchMaxResultsPerTerm: 50,
  /**
   * Whether the adjacent-tooling static matrix is enabled. Default true.
   */
  adjacentToolingEnabled: true,
  /**
   * Maximum catalog entries to retain per unique source after selection dedup.
   * Prevents a single high-volume source from dominating the selected set.
   * 0 means unlimited. Default 200.
   */
  maxEntriesPerSource: 200,
} as const;
const OFFICIAL_INDEX_DEFAULTS = {
  pageMaxBytes: 1_000_000,
  contentMaxBytes: 1_000_000,
  /**
   * Maximum number of catalog entries produced per awesome-list index.
   * 0 means unlimited — appropriate for large community lists (1,000+ entries)
   * where the catalog writer's deduplication and selection steps provide the
   * real cap. Set to a positive integer to throttle during development.
   */
  maxItemsPerIndex: 0,
} as const;
const HOST_COMMAND_DEFAULTS = {
  nativeTimeoutMs: 30_000,
  nativeMaxBufferBytes: 2_000_000,
  preflightTimeoutMs: 10_000,
} as const;
const MIRROR_LIMIT_DEFAULTS = {
  maxOfficialIndexPackageFiles: 1_000,
  maxOfficialIndexFileSizeBytes: 1_000_000,
  maxOfficialIndexPackageTotalBytes: 20_000_000,
  maxGitHubMirrorFileSizeBytes: 1_000_000,
} as const;
const BATCH_DEFAULTS = {
  remoteHarvest: 15,
  mirrorAcquire: 120,
  installBundle: 250,
} as const;
const SCAN_DEFAULTS = {
  maxDepth: 14,
  maxFiles: 20_000,
  maxBytes: 50_000_000,
} as const;

/**
 * Describes runtime config data exchanged by the lifecycle pipeline.
 */
export interface RuntimeConfig {
  env: NodeJS.ProcessEnv;
  aiEnrichment: {
    url?: string;
    apiKey?: string;
    mode: AiEnrichmentMode;
    model: string;
    allowedOrigins: readonly string[];
    requestTimeoutMs: number;
    responseMaxBytes: number;
    maxSelectedAssets: number;
    maxEvidenceItems: number;
    maxCapabilitiesPerAsset: number;
    redactFilePaths: boolean;
    redactSourceIdentifiers: boolean;
    retryMaxAttempts: number;
    retryBackoffMs: number;
    autoMinIntervalMs: number;
    requireSuccessInCi: boolean;
    allowCacheInCi: boolean;
  };
  recommendation: {
    limitOverrides: Record<string, { value: number; envVar: string }>;
    limitOverrideModes: Record<
      string,
      { value: RecommendationLimitOverrideMode; envVar: string }
    >;
  };
  install: {
    refreshPolicy: "manual" | "report-only" | "apply-safe";
    refreshIntervalMs: number;
  };
  http: {
    timeoutMs: number;
    maxResponseBytes: number;
  };
  github: {
    token?: string;
    apiVersion: string;
    fetchMaxAttempts: number;
    fetchTimeoutMs: number;
    jsonMaxBytes: number;
  };
  registries: {
    fetchTimeoutMs: number;
    metadataMaxBytes: number;
    searchMaxBytes: number;
    npmSearchResultLimit: number;
  };
  discovery: {
    referenceSourceMaxBytes: number;
    genericReferenceMaxItems: number;
    vscodeMarketplaceMaxQueries: number;
    vscodeMarketplaceMaxItemsPerQuery: number;
    vscodeMarketplaceSyncPageSize: number;
    /** Pages to fetch in the popularity-first sweep. */
    vscodeMarketplacePopularitySweepPages: number;
    /** Whether the category-taxonomy sweep is enabled. */
    vscodeMarketplaceCategorySweepEnabled: boolean;
    sourceSyncMaxPagesPerRun: number;
    npmMcpSearchQueryLimit: number;
    /**
     * Pages to paginate per source during `discover index` full-index build.
     * 0 = unlimited.
     */
    sourceSyncMaxPagesForIndexBuild: number;
    /** Days before catalog-index.jsonl is considered stale. */
    discoveryIndexMaxAgeDays: number;
    /**
     * Whether semantic similarity scoring is enabled.
     * When true and @xenova/transformers is installed, cosine similarity
     * replaces the binary keyword-overlap gate.
     */
    semanticScoringEnabled: boolean;
    /**
     * Minimum cosine similarity threshold for an entry to pass the semantic
     * demand-relevance gate (0–1). Default 0.35.
     */
    semanticScoringMinSimilarity: number;
    /**
     * Maximum number of search terms to dispatch per registry search sweep.
     * Higher values improve coverage; lower values reduce API call volume.
     */
    registrySearchMaxTerms: number;
    /**
     * Maximum results to retrieve per term per registry search call.
     */
    registrySearchMaxResultsPerTerm: number;
    /**
     * Whether the adjacent-tooling static matrix is enabled.
     * When true, packages from the adjacent-tooling matrix are added to the
     * harvest candidates for matched stack signals.
     */
    adjacentToolingEnabled: boolean;
    /**
     * Maximum catalog entries to retain per unique source after selection dedup.
     * 0 = unlimited.
     */
    maxEntriesPerSource: number;
  };
  officialIndex: {
    pageMaxBytes: number;
    contentMaxBytes: number;
    /** Maximum catalog entries per index. 0 = unlimited. */
    maxItemsPerIndex: number;
  };
  hostCommands: {
    nativeTimeoutMs: number;
    nativeMaxBufferBytes: number;
    preflightTimeoutMs: number;
  };
  mirrorLimits: {
    maxOfficialIndexPackageFiles: number;
    maxOfficialIndexFileSizeBytes: number;
    maxOfficialIndexPackageTotalBytes: number;
    maxGitHubMirrorFileSizeBytes: number;
  };
  diagnostics: {
    debugEnabled: boolean;
  };
  batches: {
    remoteHarvest: number;
    mirrorAcquire: number;
    installBundle: number;
  };
  paths: {
    homeDirectory: string;
    appData?: string;
    xdgConfigHome: string;
  };
  scan: {
    maxDepth: number;
    maxFiles: number;
    maxBytes: number;
  };
}

let runtimeConfig: RuntimeConfig | null = null;

/**
 * Returns get runtime config for the provided inputs.
 */
export function getRuntimeConfig(): RuntimeConfig {
  runtimeConfig ??= loadRuntimeConfig(process.env);
  return runtimeConfig;
}

/**
 * Loads runtime config from project state.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const homeDirectory =
    nonEmptyString(env.AGENT_HARNESS_HOME) ??
    nonEmptyString(env.HOME) ??
    nonEmptyString(env.USERPROFILE) ??
    homedir();
  const githubToken = env.GITHUB_PERSONAL_ACCESS_TOKEN || env.GITHUB_TOKEN;
  const aiEnrichmentUrl = nonEmptyString(env.AGENT_HARNESS_AI_ENRICHMENT_URL);

  return {
    env,
    aiEnrichment: {
      url: aiEnrichmentUrl,
      apiKey: nonEmptyString(env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY),
      mode: parseLiteral(
        env.AGENT_HARNESS_AI_ENRICHMENT_MODE,
        AI_ENRICHMENT_MODES,
        "manual",
        "AGENT_HARNESS_AI_ENRICHMENT_MODE",
      ),
      model:
        nonEmptyString(env.AGENT_HARNESS_AI_ENRICHMENT_MODEL) ??
        DEFAULT_AI_ENRICHMENT_MODEL,
      allowedOrigins: buildAiEnrichmentAllowedOrigins(env, aiEnrichmentUrl),
      requestTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_TIMEOUT_MS,
        AI_ENRICHMENT_DEFAULTS.requestTimeoutMs,
        "AGENT_HARNESS_AI_ENRICHMENT_TIMEOUT_MS",
      ),
      responseMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_MAX_RESPONSE_BYTES,
        AI_ENRICHMENT_DEFAULTS.responseMaxBytes,
        "AGENT_HARNESS_AI_ENRICHMENT_MAX_RESPONSE_BYTES",
      ),
      maxSelectedAssets: parsePositiveIntegerAlias(
        env,
        [
          "AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_SELECTED_ASSETS",
          "AGENT_HARNESS_AI_ENRICHMENT_MAX_SELECTED_ASSETS",
        ],
        AI_ENRICHMENT_DEFAULTS.maxSelectedAssets,
      ),
      maxEvidenceItems: parsePositiveIntegerAlias(
        env,
        [
          "AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_EVIDENCE_ITEMS",
          "AGENT_HARNESS_AI_ENRICHMENT_MAX_EVIDENCE_ITEMS",
        ],
        AI_ENRICHMENT_DEFAULTS.maxEvidenceItems,
      ),
      maxCapabilitiesPerAsset: parsePositiveIntegerAlias(
        env,
        [
          "AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_CAPABILITIES_PER_ASSET",
          "AGENT_HARNESS_AI_ENRICHMENT_MAX_CAPABILITIES_PER_ASSET",
        ],
        AI_ENRICHMENT_DEFAULTS.maxCapabilitiesPerAsset,
      ),
      redactFilePaths: parseBooleanFlag(
        env.AGENT_HARNESS_AI_ENRICHMENT_REDACT_FILE_PATHS,
        false,
        "AGENT_HARNESS_AI_ENRICHMENT_REDACT_FILE_PATHS",
      ),
      redactSourceIdentifiers: parseBooleanFlag(
        env.AGENT_HARNESS_AI_ENRICHMENT_REDACT_SOURCE_IDS,
        false,
        "AGENT_HARNESS_AI_ENRICHMENT_REDACT_SOURCE_IDS",
      ),
      retryMaxAttempts: parsePositiveInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_RETRY_MAX_ATTEMPTS,
        AI_ENRICHMENT_DEFAULTS.retryMaxAttempts,
        "AGENT_HARNESS_AI_ENRICHMENT_RETRY_MAX_ATTEMPTS",
      ),
      retryBackoffMs: parseNonNegativeInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS,
        AI_ENRICHMENT_DEFAULTS.retryBackoffMs,
        "AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS",
      ),
      autoMinIntervalMs: parseNonNegativeInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_AUTO_MIN_INTERVAL_MS,
        AI_ENRICHMENT_DEFAULTS.autoMinIntervalMs,
        "AGENT_HARNESS_AI_ENRICHMENT_AUTO_MIN_INTERVAL_MS",
      ),
      requireSuccessInCi: parseBooleanFlag(
        env.AGENT_HARNESS_AI_ENRICHMENT_REQUIRE_SUCCESS_IN_CI,
        false,
        "AGENT_HARNESS_AI_ENRICHMENT_REQUIRE_SUCCESS_IN_CI",
      ),
      allowCacheInCi: parseBooleanFlag(
        env.AGENT_HARNESS_AI_ENRICHMENT_ALLOW_CACHE_IN_CI,
        true,
        "AGENT_HARNESS_AI_ENRICHMENT_ALLOW_CACHE_IN_CI",
      ),
    },
    recommendation: {
      limitOverrides: buildRecommendationLimitOverrides(env),
      limitOverrideModes: buildRecommendationLimitOverrideModes(env),
    },
    install: {
      refreshPolicy: parseLiteral(
        env.AGENT_HARNESS_INSTALL_REFRESH_POLICY,
        ["manual", "report-only", "apply-safe"],
        INSTALL_DEFAULTS.refreshPolicy,
        "AGENT_HARNESS_INSTALL_REFRESH_POLICY",
      ),
      refreshIntervalMs: parsePositiveInteger(
        env.AGENT_HARNESS_INSTALL_REFRESH_INTERVAL_MS,
        INSTALL_DEFAULTS.refreshIntervalMs,
        "AGENT_HARNESS_INSTALL_REFRESH_INTERVAL_MS",
      ),
    },
    http: {
      timeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_HTTP_TIMEOUT_MS,
        HTTP_DEFAULTS.timeoutMs,
        "AGENT_HARNESS_HTTP_TIMEOUT_MS",
      ),
      maxResponseBytes: parsePositiveInteger(
        env.AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES,
        HTTP_DEFAULTS.maxResponseBytes,
        "AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES",
      ),
    },
    github: {
      token: githubToken || undefined,
      apiVersion:
        nonEmptyString(env.GITHUB_API_VERSION) ?? GITHUB_DEFAULTS.apiVersion,
      fetchMaxAttempts: parsePositiveInteger(
        env.AGENT_HARNESS_GITHUB_FETCH_RETRIES,
        GITHUB_DEFAULTS.fetchMaxAttempts,
        "AGENT_HARNESS_GITHUB_FETCH_RETRIES",
      ),
      fetchTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_GITHUB_FETCH_TIMEOUT_MS,
        GITHUB_DEFAULTS.fetchTimeoutMs,
        "AGENT_HARNESS_GITHUB_FETCH_TIMEOUT_MS",
      ),
      jsonMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_GITHUB_JSON_MAX_BYTES,
        GITHUB_DEFAULTS.jsonMaxBytes,
        "AGENT_HARNESS_GITHUB_JSON_MAX_BYTES",
      ),
    },
    registries: {
      fetchTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_REGISTRY_FETCH_TIMEOUT_MS,
        REGISTRY_DEFAULTS.fetchTimeoutMs,
        "AGENT_HARNESS_REGISTRY_FETCH_TIMEOUT_MS",
      ),
      metadataMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_REGISTRY_METADATA_MAX_BYTES,
        REGISTRY_DEFAULTS.metadataMaxBytes,
        "AGENT_HARNESS_REGISTRY_METADATA_MAX_BYTES",
      ),
      searchMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_REGISTRY_SEARCH_MAX_BYTES,
        REGISTRY_DEFAULTS.searchMaxBytes,
        "AGENT_HARNESS_REGISTRY_SEARCH_MAX_BYTES",
      ),
      npmSearchResultLimit: parsePositiveInteger(
        env.AGENT_HARNESS_NPM_SEARCH_RESULT_LIMIT,
        REGISTRY_DEFAULTS.npmSearchResultLimit,
        "AGENT_HARNESS_NPM_SEARCH_RESULT_LIMIT",
      ),
    },
    discovery: {
      referenceSourceMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_REFERENCE_SOURCE_MAX_BYTES,
        DISCOVERY_DEFAULTS.referenceSourceMaxBytes,
        "AGENT_HARNESS_REFERENCE_SOURCE_MAX_BYTES",
      ),
      genericReferenceMaxItems: parsePositiveInteger(
        env.AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS,
        DISCOVERY_DEFAULTS.genericReferenceMaxItems,
        "AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS",
      ),
      vscodeMarketplaceMaxQueries: parsePositiveInteger(
        env.AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES,
        DISCOVERY_DEFAULTS.vscodeMarketplaceMaxQueries,
        "AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES",
      ),
      vscodeMarketplaceMaxItemsPerQuery: parsePositiveInteger(
        env.AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY,
        DISCOVERY_DEFAULTS.vscodeMarketplaceMaxItemsPerQuery,
        "AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY",
      ),
      vscodeMarketplaceSyncPageSize: parsePositiveInteger(
        env.AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE,
        DISCOVERY_DEFAULTS.vscodeMarketplaceSyncPageSize,
        "AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE",
      ),
      vscodeMarketplacePopularitySweepPages: parseNonNegativeInteger(
        env.AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES,
        DISCOVERY_DEFAULTS.vscodeMarketplacePopularitySweepPages,
        "AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES",
      ),
      vscodeMarketplaceCategorySweepEnabled: parseBooleanFlag(
        env.AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED,
        DISCOVERY_DEFAULTS.vscodeMarketplaceCategorySweepEnabled,
        "AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED",
      ),
      sourceSyncMaxPagesPerRun: parsePositiveInteger(
        env.AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN,
        DISCOVERY_DEFAULTS.sourceSyncMaxPagesPerRun,
        "AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN",
      ),
      npmMcpSearchQueryLimit: parsePositiveInteger(
        env.AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT,
        DISCOVERY_DEFAULTS.npmMcpSearchQueryLimit,
        "AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT",
      ),
      sourceSyncMaxPagesForIndexBuild: parseNonNegativeInteger(
        env.AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD,
        DISCOVERY_DEFAULTS.sourceSyncMaxPagesForIndexBuild,
        "AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD",
      ),
      discoveryIndexMaxAgeDays: parsePositiveInteger(
        env.AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS,
        DISCOVERY_DEFAULTS.discoveryIndexMaxAgeDays,
        "AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS",
      ),
      semanticScoringEnabled: parseBooleanFlag(
        env.AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING,
        DISCOVERY_DEFAULTS.semanticScoringEnabled,
        "AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING",
      ),
      semanticScoringMinSimilarity: parseFloatFraction(
        env.AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY,
        DISCOVERY_DEFAULTS.semanticScoringMinSimilarity,
        "AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY",
      ),
      registrySearchMaxTerms: parseNonNegativeInteger(
        env.AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_TERMS,
        DISCOVERY_DEFAULTS.registrySearchMaxTerms,
        "AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_TERMS",
      ),
      registrySearchMaxResultsPerTerm: parseNonNegativeInteger(
        env.AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_RESULTS_PER_TERM,
        DISCOVERY_DEFAULTS.registrySearchMaxResultsPerTerm,
        "AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_RESULTS_PER_TERM",
      ),
      adjacentToolingEnabled: parseBooleanFlag(
        env.AGENT_HARNESS_DISCOVERY_ADJACENT_TOOLING_ENABLED,
        DISCOVERY_DEFAULTS.adjacentToolingEnabled,
        "AGENT_HARNESS_DISCOVERY_ADJACENT_TOOLING_ENABLED",
      ),
      maxEntriesPerSource: parseNonNegativeInteger(
        env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE,
        DISCOVERY_DEFAULTS.maxEntriesPerSource,
        "AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE",
      ),
    },
    officialIndex: {
      pageMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_OFFICIAL_INDEX_PAGE_MAX_BYTES,
        OFFICIAL_INDEX_DEFAULTS.pageMaxBytes,
        "AGENT_HARNESS_OFFICIAL_INDEX_PAGE_MAX_BYTES",
      ),
      contentMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_OFFICIAL_INDEX_CONTENT_MAX_BYTES,
        OFFICIAL_INDEX_DEFAULTS.contentMaxBytes,
        "AGENT_HARNESS_OFFICIAL_INDEX_CONTENT_MAX_BYTES",
      ),
      maxItemsPerIndex: parseNonNegativeInteger(
        env.AGENT_HARNESS_OFFICIAL_INDEX_MAX_ITEMS_PER_INDEX,
        OFFICIAL_INDEX_DEFAULTS.maxItemsPerIndex,
        "AGENT_HARNESS_OFFICIAL_INDEX_MAX_ITEMS_PER_INDEX",
      ),
    },
    hostCommands: {
      nativeTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_NATIVE_COMMAND_TIMEOUT_MS,
        HOST_COMMAND_DEFAULTS.nativeTimeoutMs,
        "AGENT_HARNESS_NATIVE_COMMAND_TIMEOUT_MS",
      ),
      nativeMaxBufferBytes: parsePositiveInteger(
        env.AGENT_HARNESS_NATIVE_COMMAND_MAX_BUFFER_BYTES,
        HOST_COMMAND_DEFAULTS.nativeMaxBufferBytes,
        "AGENT_HARNESS_NATIVE_COMMAND_MAX_BUFFER_BYTES",
      ),
      preflightTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
        HOST_COMMAND_DEFAULTS.preflightTimeoutMs,
        "AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS",
      ),
    },
    mirrorLimits: {
      maxOfficialIndexPackageFiles: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_FILES,
        MIRROR_LIMIT_DEFAULTS.maxOfficialIndexPackageFiles,
        "AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_FILES",
      ),
      maxOfficialIndexFileSizeBytes: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES,
        MIRROR_LIMIT_DEFAULTS.maxOfficialIndexFileSizeBytes,
        "AGENT_HARNESS_MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES",
      ),
      maxOfficialIndexPackageTotalBytes: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES,
        MIRROR_LIMIT_DEFAULTS.maxOfficialIndexPackageTotalBytes,
        "AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES",
      ),
      maxGitHubMirrorFileSizeBytes: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_GITHUB_MIRROR_FILE_SIZE_BYTES,
        MIRROR_LIMIT_DEFAULTS.maxGitHubMirrorFileSizeBytes,
        "AGENT_HARNESS_MAX_GITHUB_MIRROR_FILE_SIZE_BYTES",
      ),
    },
    diagnostics: {
      debugEnabled: parseBooleanFlag(
        env.AGENT_HARNESS_DEBUG,
        false,
        "AGENT_HARNESS_DEBUG",
      ),
    },
    batches: {
      remoteHarvest: parsePositiveInteger(
        env.AGENT_HARNESS_REMOTE_BATCH_SIZE,
        BATCH_DEFAULTS.remoteHarvest,
        "AGENT_HARNESS_REMOTE_BATCH_SIZE",
      ),
      mirrorAcquire: parsePositiveInteger(
        env.AGENT_HARNESS_MIRROR_BATCH_SIZE,
        BATCH_DEFAULTS.mirrorAcquire,
        "AGENT_HARNESS_MIRROR_BATCH_SIZE",
      ),
      installBundle: parsePositiveInteger(
        env.AGENT_HARNESS_INSTALL_BATCH_SIZE,
        BATCH_DEFAULTS.installBundle,
        "AGENT_HARNESS_INSTALL_BATCH_SIZE",
      ),
    },
    paths: {
      homeDirectory,
      appData: nonEmptyString(env.APPDATA),
      xdgConfigHome:
        nonEmptyString(env.XDG_CONFIG_HOME) ?? join(homeDirectory, ".config"),
    },
    scan: {
      maxDepth: parsePositiveInteger(
        env.AGENT_HARNESS_SCAN_MAX_DEPTH,
        SCAN_DEFAULTS.maxDepth,
        "AGENT_HARNESS_SCAN_MAX_DEPTH",
      ),
      maxFiles: parsePositiveInteger(
        env.AGENT_HARNESS_SCAN_MAX_FILES,
        SCAN_DEFAULTS.maxFiles,
        "AGENT_HARNESS_SCAN_MAX_FILES",
      ),
      maxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_SCAN_MAX_BYTES,
        SCAN_DEFAULTS.maxBytes,
        "AGENT_HARNESS_SCAN_MAX_BYTES",
      ),
    },
  };
}

/**
 * Clears clear runtime config process-local state.
 */
export function clearRuntimeConfig(): void {
  runtimeConfig = null;
}

/**
 * Clears clear runtime config for tests process-local state.
 */
export function clearRuntimeConfigForTests(): void {
  clearRuntimeConfig();
}

function buildRecommendationLimitOverrides(
  env: NodeJS.ProcessEnv,
): Record<string, { value: number; envVar: string }> {
  return Object.fromEntries(
    Object.entries(RECOMMENDATION_LIMIT_OVERRIDE_ENV_BY_HOST).flatMap(
      ([host, envVar]) => {
        const rawValue = nonEmptyString(env[envVar]);
        if (!rawValue) {
          return [];
        }

        return [
          [host, { value: parsePositiveInteger(rawValue, 1, envVar), envVar }],
        ];
      },
    ),
  );
}

function buildRecommendationLimitOverrideModes(
  env: NodeJS.ProcessEnv,
): Record<string, { value: RecommendationLimitOverrideMode; envVar: string }> {
  return Object.fromEntries(
    Object.entries(RECOMMENDATION_LIMIT_OVERRIDE_MODE_ENV_BY_HOST).flatMap(
      ([host, envVar]) => {
        const rawValue = nonEmptyString(env[envVar]);
        if (!rawValue) {
          return [];
        }

        return [
          [
            host,
            {
              value: parseLiteral<RecommendationLimitOverrideMode>(
                rawValue,
                RECOMMENDATION_LIMIT_OVERRIDE_MODES,
                "preserve",
                envVar,
              ),
              envVar,
            },
          ],
        ];
      },
    ),
  );
}

function buildAiEnrichmentAllowedOrigins(
  env: NodeJS.ProcessEnv,
  aiEnrichmentUrl: string | undefined,
): readonly string[] {
  const configuredOrigins = parseHttpsOriginList(
    env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS,
    "AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS",
  );
  const endpointOrigin = extractHttpsOrigin(aiEnrichmentUrl);

  return dedupeStrings([
    ...DEFAULT_AI_ENRICHMENT_ALLOWED_ORIGINS,
    ...configuredOrigins,
    ...(endpointOrigin ? [endpointOrigin] : []),
  ]);
}

function extractHttpsOrigin(value: string | undefined): string | undefined {
  const trimmedValue = nonEmptyString(value);
  if (!trimmedValue) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    return parsedUrl.protocol === "https:" ? parsedUrl.origin : undefined;
  } catch {
    return undefined;
  }
}

function parseHttpsOriginList(
  value: string | undefined,
  envName: string,
): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }

  return value
    .split(/[\r\n,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizeHttpsOrigin(entry, envName));
}

function normalizeHttpsOrigin(value: string, envName: string): string {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== "https:") {
      throw new Error("origin must use https");
    }
    return parsedUrl.origin;
  } catch (error) {
    throw new Error(
      `${envName} must contain comma- or newline-separated https origins when set: ${value}`,
      { cause: error },
    );
  }
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined;
}

function parsePositiveIntegerAlias(
  env: NodeJS.ProcessEnv,
  envNames: readonly string[],
  defaultValue: number,
): number {
  for (const envName of envNames) {
    const rawValue = nonEmptyString(env[envName]);
    if (rawValue) {
      return parsePositiveInteger(rawValue, defaultValue, envName);
    }
  }

  return defaultValue;
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  envName: string,
): number {
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${envName} must be a positive integer when set.`);
  }

  return parsedValue;
}

function parseNonNegativeInteger(
  value: string | undefined,
  defaultValue: number,
  envName: string,
): number {
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${envName} must be a non-negative integer when set.`);
  }

  return parsedValue;
}

function parseLiteral<T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
  defaultValue: T,
  envName: string,
): T {
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }

  const normalizedValue = value.trim();
  if ((allowedValues as readonly string[]).includes(normalizedValue)) {
    return normalizedValue as T;
  }

  throw new Error(
    `${envName} must be one of: ${allowedValues.join(", ")} when set.`,
  );
}

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
  envName: string,
): boolean {
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  throw new Error(`${envName} must be a boolean when set.`);
}

function parseFloatFraction(
  value: string | undefined,
  defaultValue: number,
  envName: string,
): number {
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }

  const parsedValue = Number(value.trim());
  if (Number.isNaN(parsedValue) || parsedValue < 0 || parsedValue > 1) {
    throw new Error(`${envName} must be a number between 0 and 1 when set.`);
  }

  return parsedValue;
}

/**
 * Test-only internals for the runtime config module.
 * These are not part of the public API and should not be used in production code.
 */
export const runtimeConfigInternals = {
  /**
   * Resets the cached singleton so the next `getRuntimeConfig()` call
   * re-reads `process.env`. Only use in tests that mutate env vars.
   */
  resetCacheForTesting(): void {
    clearRuntimeConfig();
  },
};
