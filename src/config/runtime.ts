import { homedir } from "node:os";
import { join } from "node:path";

export interface RuntimeConfig {
  github: {
    apiVersion: string;
    fetchRetries: number;
    token?: string;
  };
  batches: {
    install: string;
    mirror: string;
    remote: number;
  };
  paths: {
    homeDirectory: string;
    copilotCuratedRoot: string;
    vsCodeUserSettingsPath: string;
  };
  scan: {
    maxFiles: number;
    maxDepth: number;
    maxBytes: number;
  };
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): RuntimeConfig {
  const homeDirectory = homedir();
  return {
    github: {
      apiVersion: env.GITHUB_API_VERSION ?? "2022-11-28",
      fetchRetries: readPositiveInteger(
        env.AGENT_HARNESS_GITHUB_FETCH_RETRIES,
        3,
      ),
      token: env.GITHUB_PERSONAL_ACCESS_TOKEN ?? env.GITHUB_TOKEN,
    },
    batches: {
      install: readPositiveIntegerString(
        env.AGENT_HARNESS_INSTALL_BATCH_SIZE,
        "250",
      ),
      mirror: readPositiveIntegerString(
        env.AGENT_HARNESS_MIRROR_BATCH_SIZE,
        "120",
      ),
      remote: readPositiveInteger(env.AGENT_HARNESS_REMOTE_BATCH_SIZE, 15),
    },
    paths: {
      homeDirectory,
      copilotCuratedRoot:
        env.AGENT_HARNESS_COPILOT_CURATED_ROOT ??
        join(homeDirectory, ".copilot", "agent-harness"),
      vsCodeUserSettingsPath: resolveVsCodeUserSettingsPath(
        env,
        platform,
        homeDirectory,
      ),
    },
    scan: {
      maxFiles: readPositiveInteger(env.AGENT_HARNESS_SCAN_MAX_FILES, 10000),
      maxDepth: readPositiveInteger(env.AGENT_HARNESS_SCAN_MAX_DEPTH, 20),
      maxBytes: readPositiveInteger(
        env.AGENT_HARNESS_SCAN_MAX_BYTES,
        50 * 1024 * 1024,
      ),
    },
  };
}

function resolveVsCodeUserSettingsPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homeDirectory: string,
): string {
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(homeDirectory, "AppData", "Roaming");
    return join(appData, "Code", "User", "settings.json");
  }

  if (platform === "darwin") {
    return join(
      homeDirectory,
      "Library",
      "Application Support",
      "Code",
      "User",
      "settings.json",
    );
  }

  return join(
    env.XDG_CONFIG_HOME ?? join(homeDirectory, ".config"),
    "Code",
    "User",
    "settings.json",
  );
}

function readPositiveIntegerString(
  value: string | undefined,
  fallback: string,
): string {
  return String(readPositiveInteger(value, Number(fallback)));
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
