import { homedir } from "node:os";
import { join } from "node:path";

import type { AiEnrichmentMode } from "../types.js";

const DEFAULT_AI_ENRICHMENT_MODEL = "gpt-4o-mini";
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
    npmMcpSearchQueryLimit: number;
  };
  officialIndex: {
    pageMaxBytes: number;
    contentMaxBytes: number;
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
        20_000,
        "AGENT_HARNESS_AI_ENRICHMENT_TIMEOUT_MS",
      ),
      responseMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_MAX_RESPONSE_BYTES,
        1_000_000,
        "AGENT_HARNESS_AI_ENRICHMENT_MAX_RESPONSE_BYTES",
      ),
      maxSelectedAssets: parsePositiveInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_MAX_SELECTED_ASSETS,
        50,
        "AGENT_HARNESS_AI_ENRICHMENT_MAX_SELECTED_ASSETS",
      ),
      maxEvidenceItems: parsePositiveInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_MAX_EVIDENCE_ITEMS,
        12,
        "AGENT_HARNESS_AI_ENRICHMENT_MAX_EVIDENCE_ITEMS",
      ),
      maxCapabilitiesPerAsset: parsePositiveInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_MAX_CAPABILITIES_PER_ASSET,
        16,
        "AGENT_HARNESS_AI_ENRICHMENT_MAX_CAPABILITIES_PER_ASSET",
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
        1,
        "AGENT_HARNESS_AI_ENRICHMENT_RETRY_MAX_ATTEMPTS",
      ),
      retryBackoffMs: parseNonNegativeInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS,
        1_000,
        "AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS",
      ),
      autoMinIntervalMs: parseNonNegativeInteger(
        env.AGENT_HARNESS_AI_ENRICHMENT_AUTO_MIN_INTERVAL_MS,
        300_000,
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
    http: {
      timeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_HTTP_TIMEOUT_MS,
        10_000,
        "AGENT_HARNESS_HTTP_TIMEOUT_MS",
      ),
      maxResponseBytes: parsePositiveInteger(
        env.AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES,
        1_000_000,
        "AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES",
      ),
    },
    github: {
      token: githubToken || undefined,
      apiVersion: nonEmptyString(env.GITHUB_API_VERSION) ?? "2022-11-28",
      fetchMaxAttempts: parsePositiveInteger(
        env.AGENT_HARNESS_GITHUB_FETCH_RETRIES,
        3,
        "AGENT_HARNESS_GITHUB_FETCH_RETRIES",
      ),
      fetchTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_GITHUB_FETCH_TIMEOUT_MS,
        10_000,
        "AGENT_HARNESS_GITHUB_FETCH_TIMEOUT_MS",
      ),
      jsonMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_GITHUB_JSON_MAX_BYTES,
        2_000_000,
        "AGENT_HARNESS_GITHUB_JSON_MAX_BYTES",
      ),
    },
    registries: {
      fetchTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_REGISTRY_FETCH_TIMEOUT_MS,
        5_000,
        "AGENT_HARNESS_REGISTRY_FETCH_TIMEOUT_MS",
      ),
      metadataMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_REGISTRY_METADATA_MAX_BYTES,
        2_000_000,
        "AGENT_HARNESS_REGISTRY_METADATA_MAX_BYTES",
      ),
      searchMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_REGISTRY_SEARCH_MAX_BYTES,
        500_000,
        "AGENT_HARNESS_REGISTRY_SEARCH_MAX_BYTES",
      ),
      npmSearchResultLimit: parsePositiveInteger(
        env.AGENT_HARNESS_NPM_SEARCH_RESULT_LIMIT,
        12,
        "AGENT_HARNESS_NPM_SEARCH_RESULT_LIMIT",
      ),
    },
    discovery: {
      referenceSourceMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_REFERENCE_SOURCE_MAX_BYTES,
        600_000,
        "AGENT_HARNESS_REFERENCE_SOURCE_MAX_BYTES",
      ),
      genericReferenceMaxItems: parsePositiveInteger(
        env.AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS,
        8,
        "AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS",
      ),
      vscodeMarketplaceMaxQueries: parsePositiveInteger(
        env.AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES,
        4,
        "AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES",
      ),
      vscodeMarketplaceMaxItemsPerQuery: parsePositiveInteger(
        env.AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY,
        6,
        "AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY",
      ),
      npmMcpSearchQueryLimit: parsePositiveInteger(
        env.AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT,
        8,
        "AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT",
      ),
    },
    officialIndex: {
      pageMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_OFFICIAL_INDEX_PAGE_MAX_BYTES,
        1_000_000,
        "AGENT_HARNESS_OFFICIAL_INDEX_PAGE_MAX_BYTES",
      ),
      contentMaxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_OFFICIAL_INDEX_CONTENT_MAX_BYTES,
        1_000_000,
        "AGENT_HARNESS_OFFICIAL_INDEX_CONTENT_MAX_BYTES",
      ),
    },
    hostCommands: {
      nativeTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_NATIVE_COMMAND_TIMEOUT_MS,
        30_000,
        "AGENT_HARNESS_NATIVE_COMMAND_TIMEOUT_MS",
      ),
      nativeMaxBufferBytes: parsePositiveInteger(
        env.AGENT_HARNESS_NATIVE_COMMAND_MAX_BUFFER_BYTES,
        2_000_000,
        "AGENT_HARNESS_NATIVE_COMMAND_MAX_BUFFER_BYTES",
      ),
      preflightTimeoutMs: parsePositiveInteger(
        env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
        10_000,
        "AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS",
      ),
    },
    mirrorLimits: {
      maxOfficialIndexPackageFiles: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_FILES,
        1_000,
        "AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_FILES",
      ),
      maxOfficialIndexFileSizeBytes: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES,
        1_000_000,
        "AGENT_HARNESS_MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES",
      ),
      maxOfficialIndexPackageTotalBytes: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES,
        20_000_000,
        "AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES",
      ),
      maxGitHubMirrorFileSizeBytes: parsePositiveInteger(
        env.AGENT_HARNESS_MAX_GITHUB_MIRROR_FILE_SIZE_BYTES,
        1_000_000,
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
        15,
        "AGENT_HARNESS_REMOTE_BATCH_SIZE",
      ),
      mirrorAcquire: parsePositiveInteger(
        env.AGENT_HARNESS_MIRROR_BATCH_SIZE,
        120,
        "AGENT_HARNESS_MIRROR_BATCH_SIZE",
      ),
      installBundle: parsePositiveInteger(
        env.AGENT_HARNESS_INSTALL_BATCH_SIZE,
        250,
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
        14,
        "AGENT_HARNESS_SCAN_MAX_DEPTH",
      ),
      maxFiles: parsePositiveInteger(
        env.AGENT_HARNESS_SCAN_MAX_FILES,
        20000,
        "AGENT_HARNESS_SCAN_MAX_FILES",
      ),
      maxBytes: parsePositiveInteger(
        env.AGENT_HARNESS_SCAN_MAX_BYTES,
        50_000_000,
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

  if ((allowedValues as readonly string[]).includes(value)) {
    return value as T;
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
