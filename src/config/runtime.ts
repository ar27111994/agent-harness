import { homedir } from "node:os";
import { join } from "node:path";

export interface RuntimeConfig {
  env: NodeJS.ProcessEnv;
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

export function getRuntimeConfig(): RuntimeConfig {
  runtimeConfig ??= loadRuntimeConfig(process.env);
  return runtimeConfig;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const homeDirectory =
    nonEmptyString(env.AGENT_HARNESS_HOME) ??
    nonEmptyString(env.HOME) ??
    nonEmptyString(env.USERPROFILE) ??
    homedir();
  const githubToken = env.GITHUB_PERSONAL_ACCESS_TOKEN || env.GITHUB_TOKEN;

  return {
    env,
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

export function clearRuntimeConfig(): void {
  runtimeConfig = null;
}

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
