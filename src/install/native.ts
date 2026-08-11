import { join } from "node:path";

import { CliUsageError } from "../cli-help-format.js";
import {
  executeExtensionInstallAction,
  formatExtensionInstallActions,
  resolveVsCodeExtensionId,
  type ExtensionInstallAction,
  type ExtensionInstallOperation,
  type NativeInstallResult,
} from "../host-adapters/extension-installer.js";
import {
  resolveHostAdapter,
  type HostAdapter,
} from "../host-adapters/registry.js";
import { getOptionValue, hasSingleFlag } from "../lib/cli-options.js";
import {
  formatActionableDiagnostic,
  noNativeInstallAssetsDiagnostic,
  unknownHostDiagnostic,
  unsupportedNativeInstallDiagnostic,
} from "../lib/diagnostics.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runNativeInstallPreflight,
} from "../lib/preflight.js";
import { readJsonFileOrNull, writeJsonFile } from "../files.js";
import { assertAssetCatalogEntry, assertRecommendationReport } from "../manifest-validation.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  CopilotWorkspaceProfileManifest,
  RecommendationEntry,
  RecommendationReport,
} from "../types.js";
import { REPORT_FILE_PATH } from "../recommend/constants.js";
import { NATIVE_INSTALL_STATE_OUTPUT_PATH } from "./paths.js";
import { sanitizeAssetId } from "./utils.js";

type NativeInstallCliOperation = "plan" | ExtensionInstallOperation;

/**
 * Provides native install management for the lifecycle pipeline.
 */
export async function manageNativeInstall(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const hostName = getOptionValue(args, "--host") ?? "vscode";
  const operation = parseNativeInstallOperation(
    getOptionValue(args, "--operation") ?? "plan",
  );
  const apply = hasSingleFlag(args, "--apply");
  const adapter = resolveHostAdapter(hostName);

  if (!adapter) {
    // #446 contract: CliUsageError carries a ONE-LINE message (printCliUsageError
    // prefixes only the first line with `error:`); the full actionable
    // diagnostic goes through the separate diagnostic output path first
    // (the same convention the wire dispatcher uses for unknown hosts).
    const diagnostic = unknownHostDiagnostic(hostName);
    console.error(formatActionableDiagnostic(diagnostic));
    throw new CliUsageError(
      diagnostic.summary,
      "agent-harness install native --help",
    );
  }

  if (!adapter.nativeInstall) {
    const diagnostic = unsupportedNativeInstallDiagnostic({
      displayName: adapter.displayName,
      hostId: adapter.id,
    });
    console.error(formatActionableDiagnostic(diagnostic));
    throw new CliUsageError(
      diagnostic.summary,
      "agent-harness install native --help",
    );
  }

  const plans = await collectNativeInstallAssetPlans(projectRoot, adapter);
  const assets = plans.map((plan) => plan.asset);
  const actions = adapter.nativeInstall.collectActions(assets);

  if (actions.length === 0) {
    console.log(
      formatActionableDiagnostic(
        noNativeInstallAssetsDiagnostic({
          assetKind: adapter.nativeInstall.assetKind,
          displayName: adapter.displayName,
          hostId: adapter.id,
        }),
      ),
    );
    return;
  }

  // #444 AC3 (review): extensions whose ONLY recommendation match is a
  // single-token coincidence (declared-package token absent from the curated
  // identity) are excluded from the plan AND from apply/remove execution,
  // with a visible note — the harness must not propose or install lookalikes
  // (e.g. a theme whose marketplace description contains the workspace's `c8`
  // dependency).
  const planByExtensionId = new Map<string, NativeInstallAssetPlan>();
  for (const plan of plans) {
    planByExtensionId.set(plan.extensionId, plan);
  }
  const coincidentalExtensionIds = new Set(
    plans
      .filter((plan) => plan.recommendation?.coincidentalMatchOnly === true)
      .map((plan) => plan.extensionId),
  );
  const includedActions = actions.filter(
    (action) => !coincidentalExtensionIds.has(action.extensionId),
  );
  const excludedActions = actions.filter((action) =>
    coincidentalExtensionIds.has(action.extensionId),
  );

  if (operation === "plan") {
    printNativeInstallPlan(adapter, includedActions, plans);
    printExcludedCoincidentalExtensions(excludedActions, planByExtensionId);
    return;
  }

  // Only MUTATING operations require --apply; verify is read-only and runs
  // directly (original contract, review).
  if ((operation === "install" || operation === "remove") && !apply) {
    printNativeInstallPlan(adapter, includedActions, plans);
    printExcludedCoincidentalExtensions(excludedActions, planByExtensionId);
    console.log(
      `Native ${operation} is mutating. Re-run with --apply to execute it.`,
    );
    return;
  }

  printExcludedCoincidentalExtensions(excludedActions, planByExtensionId);

  const diagnostics = await runNativeInstallPreflight(adapter);
  if (diagnostics.length > 0) {
    console.log(formatPreflightDiagnostics(diagnostics));
  }
  assertNoPreflightErrors(diagnostics);

  const results: NativeInstallResult[] = [];
  for (const action of includedActions) {
    const result = await executeExtensionInstallAction(action, operation);
    results.push(result);
    console.log(
      `${result.success ? "ok" : "failed"}: ${result.message} (${result.extensionId})`,
    );
  }

  await writeNativeInstallState(projectRoot, adapter, operation, results);

  const failedResults = results.filter((result) => !result.success);
  if (failedResults.length > 0) {
    throw new Error(
      `Native ${operation} failed for ${failedResults.length} extension(s).`,
    );
  }
}

/**
 * One activation-manifest asset resolved for the native install plan, with
 * its workspace recommendation (when available) and its host extension id.
 */
interface NativeInstallAssetPlan {
  asset: AssetCatalogEntry;
  recommendation?: RecommendationEntry;
  extensionId: string;
}

/**
 * Loads the per-host recommendations from the persisted report, keyed by
 * catalog asset id. A missing or unreadable report yields an empty map —
 * the plan then shows "no workspace recommendation" status lines instead of
 * guessing a basis.
 */
async function loadRecommendationsByAssetId(
  projectRoot: string,
  adapter: HostAdapter,
): Promise<Map<string, RecommendationEntry>> {
  const report = await readJsonFileOrNull<RecommendationReport>(
    join(projectRoot, ...REPORT_FILE_PATH),
    assertRecommendationReport,
  );
  const byAssetId = new Map<string, RecommendationEntry>();
  for (const entry of report?.topByHost[adapter.lifecycleHost] ?? []) {
    byAssetId.set(entry.assetId, entry);
  }
  return byAssetId;
}

async function collectNativeInstallAssetPlans(
  projectRoot: string,
  adapter: HostAdapter,
): Promise<NativeInstallAssetPlan[]> {
  const nativeInstall = adapter.nativeInstall;
  if (!nativeInstall) {
    return [];
  }

  const assetIds = new Set<string>();
  const activationRoot = join(projectRoot, "activate", adapter.lifecycleHost);
  const profileManifest =
    await readJsonFileOrNull<CopilotWorkspaceProfileManifest>(
      join(activationRoot, "workspace-profile-manifest.json"),
    );
  for (const assetId of profileManifest?.selectedExtensionIds ?? []) {
    assetIds.add(assetId);
  }
  for (const assetId of profileManifest?.selectedAssetIds ?? []) {
    assetIds.add(assetId);
  }

  const activationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(activationRoot, "activation-manifest.json"),
  );
  for (const assetId of activationManifest?.activeAssets ?? []) {
    assetIds.add(assetId);
  }

  const recommendations = await loadRecommendationsByAssetId(
    projectRoot,
    adapter,
  );

  const plans: NativeInstallAssetPlan[] = [];
  for (const assetId of assetIds) {
    const asset = await readJsonFileOrNull<AssetCatalogEntry>(
      join(activationRoot, sanitizeAssetId(assetId), "asset.json"),
      assertAssetCatalogEntry,
    );
    if (!asset || asset.assetKind !== nativeInstall.assetKind) {
      continue;
    }
    const extensionId = resolveVsCodeExtensionId(asset);
    if (extensionId === undefined) {
      continue;
    }
    plans.push({
      asset,
      extensionId,
      recommendation: recommendations.get(asset.id),
    });
  }

  return plans.sort((left, right) =>
    left.asset.id.localeCompare(right.asset.id),
  );
}

function printNativeInstallPlan(
  adapter: HostAdapter,
  actions: ExtensionInstallAction[],
  plans: readonly NativeInstallAssetPlan[],
): void {
  console.log(`Native install plan for ${adapter.displayName}:`);
  if (actions.length === 0) {
    console.log("  (no extensions remain after excluding single-token coincidences)");
    return;
  }
  for (const line of formatExtensionInstallActions(actions)) {
    console.log(`  ${line}`);
  }
  // #444 review: every plan entry carries an explicit status line — the
  // match basis (workspace recommendation or activation-manifest keep) and
  // the fact that native installs are NOT mirrored (host CLI installs).
  // Iterating PLANS filtered by the included action set keeps the status
  // lines 1:1 with the installed actions and naturally skips excluded plans
  // (no lookup-by-action map, no unreachable miss branch).
  const includedExtensionIds = new Set(
    actions.map((action) => action.extensionId),
  );
  for (const plan of plans) {
    if (!includedExtensionIds.has(plan.extensionId)) {
      continue;
    }
    let basis: string;
    if (plan.recommendation) {
      const fitReasons = plan.recommendation.reasons.filter((reason) =>
        reason.startsWith("fit:"),
      );
      if (fitReasons.length > 0) {
        basis = `basis: ${plan.recommendation.recommendationBasis} (${fitReasons.join(", ")})`;
      } else {
        basis = `basis: ${plan.recommendation.recommendationBasis}`;
      }
    } else {
      basis = "basis: no workspace recommendation (kept from activation manifest)";
    }
    console.log(`    ${plan.extensionId}: ${basis} — native install via host CLI (not mirrored)`);
  }
}

function printExcludedCoincidentalExtensions(
  excludedActions: ExtensionInstallAction[],
  planByExtensionId: ReadonlyMap<string, NativeInstallAssetPlan>,
): void {
  if (excludedActions.length === 0) {
    return;
  }
  console.log(
    "Excluded from plan (single-token coincidence — no workspace identity match):",
  );
  for (const action of excludedActions) {
    const plan = planByExtensionId.get(action.extensionId);
    const terms =
      plan?.recommendation?.matchedSignals
        .map((match) => `${match.signalType}:${match.term}`)
        .join(", ") ?? "";
    let line = `  ${action.host}:${action.extensionId}`;
    if (terms.length > 0) {
      line += ` (matched only: ${terms})`;
    }
    console.log(line);
  }
}

async function writeNativeInstallState(
  projectRoot: string,
  adapter: HostAdapter,
  operation: ExtensionInstallOperation,
  results: NativeInstallResult[],
): Promise<void> {
  await writeJsonFile(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    host: adapter.id,
    operation,
    results,
  });
}

function parseNativeInstallOperation(value: string): NativeInstallCliOperation {
  if (
    value === "plan" ||
    value === "install" ||
    value === "verify" ||
    value === "remove"
  ) {
    return value;
  }

  throw new CliUsageError(
    `Invalid native install operation '${value}'. Must be one of: plan, install, verify, remove.`,
    "agent-harness install native --help",
  );
}

/**
 * Exposes narrow native install internals for focused asset collection tests.
 */
export const installNativeInternals = {
  collectNativeInstallAssetPlans,
  parseNativeInstallOperation,
};
