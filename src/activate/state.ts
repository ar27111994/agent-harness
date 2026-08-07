/**
 * activate/state — activation state inspection: diff and explain (#435).
 *
 * Extracted from activate.ts: the read-only activation state surfaces
 * (diff between current/previous manifests, per-asset explain with truthful
 * reason strings) plus the shared CLI option parsers and set-diff helpers.
 * Activation materialization (host/rollback/reset) stays in activate.ts.
 */

import { join } from "node:path";

import {
  readJsonFileOrNull,
  removePath,
  toPosixPath,
} from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import { listHostAdapters } from "../host-adapters/registry.js";
import {
  assertActivationManifest,
  assertCopilotWorkspaceProfileManifest,
  assertRecommendationReport,
} from "../manifest-validation.js";
import type {
  ActivationManifest,
  CopilotWorkspaceProfileManifest,
  HostTarget,
  RecommendationReport,
} from "../types.js";
import {
  ACTIVATION_HOSTS,
  type ActivationHost,
  SHARED_HOST_TARGET,
  getActivationBudget,
  isNegativelyScored,
} from "./selection.js";

export const ACTIVATION_MANIFEST_FILE = "activation-manifest.json";
export const ACTIVATION_PREVIOUS_MANIFEST_FILE =
  "activation-manifest.previous.json";

export async function diffActivationState(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const requestedHost = parseActivationHostOption(
    getOptionalOptionValue(args, "--host"),
    "--host",
  );
  const hosts = requestedHost ? [requestedHost] : ACTIVATION_HOSTS;

  for (const host of hosts) {
    const runtimeRoot = join(projectRoot, "activate", host);
    const currentManifest = await readJsonFileOrNull<ActivationManifest>(
      join(runtimeRoot, ACTIVATION_MANIFEST_FILE),
      assertActivationManifest,
    );
    const previousManifest = await readJsonFileOrNull<ActivationManifest>(
      join(runtimeRoot, ACTIVATION_PREVIOUS_MANIFEST_FILE),
      assertActivationManifest,
    );

    if (!currentManifest || !previousManifest) {
      console.log(`No comparable activation manifests found for ${host}`);
      continue;
    }

    const assetDiff = diffStringSets(
      previousManifest.activeAssets,
      currentManifest.activeAssets,
    );
    const bundleDiff = diffStringSets(
      previousManifest.activeBundles,
      currentManifest.activeBundles,
    );
    console.log(
      `Activation diff for ${host}: ${previousManifest.generationId ?? "unknown"} -> ${currentManifest.generationId ?? "unknown"}`,
    );
    console.log(`  Added assets: ${formatDiffList(assetDiff.added)}`);
    console.log(`  Removed assets: ${formatDiffList(assetDiff.removed)}`);
    console.log(`  Added bundles: ${formatDiffList(bundleDiff.added)}`);
    console.log(`  Removed bundles: ${formatDiffList(bundleDiff.removed)}`);
  }
}

export async function explainActivationState(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const assetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedHost = parseActivationHostOption(
    getOptionalOptionValue(args, "--host"),
    "--host",
  );

  if (!assetId) {
    throw new Error("explain requires --asset <assetId>");
  }

  const hosts = requestedHost ? [requestedHost] : ACTIVATION_HOSTS;
  const lines: string[] = [];

  for (const host of hosts) {
    const runtimeRoot = join(projectRoot, "activate", host);
    const activationManifest = await readJsonFileOrNull<ActivationManifest>(
      join(runtimeRoot, ACTIVATION_MANIFEST_FILE),
      assertActivationManifest,
    );

    if (!activationManifest) {
      continue;
    }

    const recommendationReport = await readJsonFileOrNull<RecommendationReport>(
      join(projectRoot, "state", "recommendations.json"),
      assertRecommendationReport,
    );
    const recommendationHost = activationManifest.recommendationHost ?? host;
    const recommendationEntry = recommendationReport?.topByHost[
      recommendationHost
    ]?.find((entry) => entry.assetId === assetId);
    const suggestedBundle = recommendationReport?.suggestedBundles.find(
      (bundle) =>
        bundle.host === recommendationHost &&
        (bundle.assetIds.includes(assetId) ||
          (bundle.budgetPrunedAssetIds?.includes(assetId) ?? false)),
    );
    const budgetPrunedAsset = suggestedBundle?.budgetPrunedAssets?.find(
      (asset) => asset.assetId === assetId,
    );
    const activationBudget =
      activationManifest.activationBudget ??
      recommendationReport?.hostSummaries[recommendationHost]
        ?.activationBudget ??
      getActivationBudget(host);
    const isActive = activationManifest.activeAssets.includes(assetId);
    lines.push(`Host ${host}: ${isActive ? "active" : "not active"}`);
    lines.push(`  generation: ${activationManifest.generationId ?? "unknown"}`);
    lines.push(`  bundles: ${activationManifest.activeBundles.join(", ")}`);
    lines.push(`  activation budget: ${activationBudget}`);
    if (recommendationEntry) {
      lines.push(
        `  recommendation: rank ${recommendationEntry.rank}, score ${recommendationEntry.score}, prompt weight ${recommendationEntry.estimatedPromptWeight}`,
      );
    }
    if (isActive) {
      // Truthful reason strings (#426): the staged-bundle breadth path is
      // intentional (mirror locks + catalog selection), so active assets with
      // no recommendation are labeled as such instead of claiming
      // recommendation-order selection. A negative score is a hard boundary
      // in current selection; if a legacy activation still contains one,
      // explain says exactly that.
      if (isNegativelyScored(recommendationEntry)) {
        lines.push(
          "  reason: active from a legacy activation despite a negative recommendation score for this host (not eligible under current selection policy)",
        );
      } else if (recommendationEntry) {
        lines.push(
          "  reason: selected from staged bundle outputs by recommendation order, session intent, trust, and activation budget",
        );
      } else {
        lines.push(
          "  reason: activated from staged bundle (not recommended for this host — catalog-selection breadth)",
        );
      }
    } else if (budgetPrunedAsset) {
      lines.push(`  reason: ${budgetPrunedAsset.reason}`);
    } else if (suggestedBundle) {
      lines.push(
        `  reason: present in suggested bundle ${suggestedBundle.bundleId} but absent from current activation manifest`,
      );
    } else {
      lines.push(
        "  reason: absent from the current activation manifest and current suggested bundle metadata",
      );
    }

    if (host === "copilot-vscode") {
      const profileManifest =
        await readJsonFileOrNull<CopilotWorkspaceProfileManifest>(
          join(runtimeRoot, "workspace-profile-manifest.json"),
          assertCopilotWorkspaceProfileManifest,
        );
      if (profileManifest) {
        lines.push(
          `  profile selected: ${profileManifest.selectedAssetIds.includes(assetId) ? "yes" : "no"}`,
        );
      }
    }
  }

  if (lines.length === 0) {
    console.log(`Asset ${assetId} has not been activated for any host.`);
    return;
  }

  console.log(`Activation explain for ${assetId}`);
  console.log(lines.join("\n"));
}

export async function resetActivationState(projectRoot: string): Promise<void> {
  await removePath(join(projectRoot, "activate"));
  console.log(
    `Activation state reset under ${toPosixPath(join(projectRoot, "activate"))}`,
  );
}

export function getOptionalOptionValue(
  args: string[],
  optionName: string,
): string | undefined {
  return getOptionValue(args, optionName);
}

/**
 * Validates a raw CLI value against every registered recommendation host id.
 */
export function parseHostTargetOption(
  value: string | undefined,
  optionName: string,
): HostTarget | undefined {
  if (value === undefined) {
    return undefined;
  }

  const targets = getHostTargets();
  if (targets.includes(value as HostTarget)) {
    return value;
  }

  throw new Error(
    `Invalid ${optionName} value: ${value}. Must be one of: ${targets.join(", ")}`,
  );
}

export function getHostTargets(): HostTarget[] {
  return [
    ...new Set([
      SHARED_HOST_TARGET,
      ...listHostAdapters().map((adapter) => adapter.recommendationHost),
    ]),
  ];
}

/**
 * Validates a raw CLI value against activation-capable lifecycle host ids.
 */
export function parseActivationHostOption(
  value: string | undefined,
  optionName: string,
): ActivationHost | undefined {
  const hostTarget = parseHostTargetOption(value, optionName);
  if (hostTarget === undefined) {
    return undefined;
  }

  if (isActivationHost(hostTarget)) {
    return hostTarget;
  }

  throw new Error(
    `Invalid ${optionName} value: ${hostTarget}. Must be one of: ${ACTIVATION_HOSTS.join(", ")}`,
  );
}

/**
 * Returns whether a host target can be directly materialized by activation.
 */
export function isActivationHost(value: HostTarget): value is ActivationHost {
  return ACTIVATION_HOSTS.includes(value as ActivationHost);
}

export function diffStringSets(
  left: string[],
  right: string[],
): { added: string[]; removed: string[] } {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return {
    added: [...rightSet]
      .filter((value) => !leftSet.has(value))
      .sort((a, b) => a.localeCompare(b)),
    removed: [...leftSet]
      .filter((value) => !rightSet.has(value))
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function formatDiffList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
