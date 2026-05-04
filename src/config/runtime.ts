import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_AI_ENRICHMENT_MODEL = "gpt-4o-mini";
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
    model: string;
    allowedOrigins: readonly string[];
  };
  github: {
    token?: string;
    apiVersion: string;
    fetchMaxAttempts: number;
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

  return {
    env,
    aiEnrichment: {
      url: nonEmptyString(env.AGENT_HARNESS_AI_ENRICHMENT_URL),
      apiKey: nonEmptyString(env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY),
      model:
        nonEmptyString(env.AGENT_HARNESS_AI_ENRICHMENT_MODEL) ??
        DEFAULT_AI_ENRICHMENT_MODEL,
      allowedOrigins: DEFAULT_AI_ENRICHMENT_ALLOWED_ORIGINS,
    },
    github: {
      token: githubToken || undefined,
      apiVersion: nonEmptyString(env.GITHUB_API_VERSION) ?? "2022-11-28",
      fetchMaxAttempts: parsePositiveInteger(
        env.AGENT_HARNESS_GITHUB_FETCH_RETRIES,
        3,
        "AGENT_HARNESS_GITHUB_FETCH_RETRIES",
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
