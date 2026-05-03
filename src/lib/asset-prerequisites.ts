import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import { readJsonFileOrNull } from "../files.js";
import { sanitizeAssetId } from "./safe-paths.js";
import type { HostAdapter } from "../host-adapters/registry.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetPrerequisite,
  CopilotWorkspaceProfileManifest,
} from "../types.js";
import type { PreflightDiagnostic, PreflightSeverity } from "./preflight.js";

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  github: ["GITHUB_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  sentry: ["SENTRY_AUTH_TOKEN"],
};

export function buildAssetPrerequisitesFromMetadata(options: {
  providers: string[];
  envVars: string[];
  setupUrl?: string;
}): AssetPrerequisite[] {
  const prerequisites: AssetPrerequisite[] = [];

  for (const provider of uniqueStrings(options.providers.map(normalizeToken))) {
    const knownEnvVars = PROVIDER_ENV_VARS[provider] ?? [];
    prerequisites.push({
      id: `auth:${provider}`,
      kind: knownEnvVars.length > 0 ? "env" : "manual",
      required: true,
      provider,
      envVars: knownEnvVars.length > 0 ? knownEnvVars : undefined,
      setupUrl: options.setupUrl,
      description:
        knownEnvVars.length > 0
          ? `Configure credentials for ${provider}.`
          : `Complete manual authentication setup for ${provider}.`,
    });
  }

  for (const envVar of uniqueStrings(options.envVars)) {
    prerequisites.push({
      id: `env:${envVar}`,
      kind: "env",
      required: true,
      envVars: [envVar],
      description: `Set required environment variable ${envVar}.`,
    });
  }

  return dedupePrerequisites(prerequisites);
}

export function buildPrerequisiteDiagnostics(
  asset: AssetCatalogEntry,
  options: { missingEnvSeverity?: PreflightSeverity } = {},
): PreflightDiagnostic[] {
  const prerequisites = asset.install.prerequisites ?? [];
  const missingEnvSeverity = options.missingEnvSeverity ?? "error";
  const env = getRuntimeConfig().env;
  const diagnostics: PreflightDiagnostic[] = [];

  for (const prerequisite of prerequisites) {
    const envVars = prerequisite.envVars ?? [];
    if (prerequisite.kind === "env" && envVars.length === 0) {
      diagnostics.push({
        severity: missingEnvSeverity,
        code: `asset-prerequisite-missing:${asset.id}:${prerequisite.id}`,
        message: `${asset.displayName} has malformed environment prerequisite '${prerequisite.description}' with no environment variables listed.`,
        action: buildPrerequisiteAction(prerequisite),
      });
      continue;
    }

    if (prerequisite.kind === "env" && envVars.length > 0) {
      const hasAnyEnvVar = envVars.some(
        (envVar) => (env[envVar]?.trim().length ?? 0) > 0,
      );
      diagnostics.push({
        severity: hasAnyEnvVar ? "info" : missingEnvSeverity,
        code: hasAnyEnvVar
          ? `asset-prerequisite-ready:${asset.id}:${prerequisite.id}`
          : `asset-prerequisite-missing:${asset.id}:${prerequisite.id}`,
        message: hasAnyEnvVar
          ? `${asset.displayName} prerequisite '${prerequisite.description}' is satisfied.`
          : `${asset.displayName} requires ${formatEnvChoices(envVars)}.`,
        action: hasAnyEnvVar
          ? undefined
          : buildPrerequisiteAction(prerequisite),
      });
      continue;
    }

    diagnostics.push({
      severity: prerequisite.required ? missingEnvSeverity : "info",
      code: `asset-prerequisite-guidance:${asset.id}:${prerequisite.id}`,
      message: `${asset.displayName} requires prerequisite '${prerequisite.description}'.`,
      action: buildPrerequisiteAction(prerequisite),
    });
  }

  return diagnostics;
}

export async function collectActivatedAssetPrerequisiteDiagnostics(
  projectRoot: string,
  adapter: HostAdapter,
  options: { missingEnvSeverity?: PreflightSeverity } = {},
): Promise<PreflightDiagnostic[]> {
  const assets = await collectActivatedAssets(projectRoot, adapter);
  return assets.flatMap((asset) =>
    buildPrerequisiteDiagnostics(asset, options),
  );
}

async function collectActivatedAssets(
  projectRoot: string,
  adapter: HostAdapter,
): Promise<AssetCatalogEntry[]> {
  const assetMap = new Map<string, Set<string>>();
  const activationHosts = [
    ...new Set<string>([adapter.lifecycleHost, "shared"]),
  ];
  const assets: AssetCatalogEntry[] = [];

  for (const activationHost of activationHosts) {
    const activationRoot = join(projectRoot, "activate", activationHost);
    const activationManifest = await readJsonFileOrNull<ActivationManifest>(
      join(activationRoot, "activation-manifest.json"),
    );
    for (const assetId of activationManifest?.activeAssets ?? []) {
      addAssetId(assetMap, activationHost, assetId);
    }

    const profileManifest =
      await readJsonFileOrNull<CopilotWorkspaceProfileManifest>(
        join(activationRoot, "workspace-profile-manifest.json"),
      );
    for (const assetId of profileManifest?.selectedAssetIds ?? []) {
      addAssetId(assetMap, activationHost, assetId);
    }
  }

  for (const [activationHost, assetIds] of assetMap.entries()) {
    for (const assetId of assetIds) {
      const asset = await readJsonFileOrNull<AssetCatalogEntry>(
        join(
          projectRoot,
          "activate",
          activationHost,
          sanitizeAssetId(assetId),
          "asset.json",
        ),
      );
      if (asset?.install?.prerequisites?.length) {
        assets.push(asset);
      }
    }
  }

  return assets.sort((left, right) => left.id.localeCompare(right.id));
}

function addAssetId(
  assetMap: Map<string, Set<string>>,
  activationHost: string,
  assetId: string,
): void {
  const assetIds = assetMap.get(activationHost) ?? new Set<string>();
  assetIds.add(assetId);
  assetMap.set(activationHost, assetIds);
}

function buildPrerequisiteAction(prerequisite: AssetPrerequisite): string {
  const actions: string[] = [];
  if ((prerequisite.envVars?.length ?? 0) > 0) {
    actions.push(`Set ${formatEnvChoices(prerequisite.envVars ?? [])}`);
  }
  if (prerequisite.setupUrl) {
    actions.push(`See ${prerequisite.setupUrl}`);
  }
  if (actions.length === 0) {
    actions.push(
      "Complete the provider setup described by the asset before applying wire-in.",
    );
  }

  return actions.join(". ");
}

function formatEnvChoices(envVars: string[]): string {
  return envVars.length > 1
    ? `one of ${envVars.join(", ")}`
    : (envVars[0] ?? "the required environment variable");
}

function dedupePrerequisites(
  prerequisites: AssetPrerequisite[],
): AssetPrerequisite[] {
  const byId = new Map<string, AssetPrerequisite>();
  for (const prerequisite of prerequisites) {
    byId.set(prerequisite.id, prerequisite);
  }
  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}
