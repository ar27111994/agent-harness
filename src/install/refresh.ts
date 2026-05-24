import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  formatActionableDiagnostic,
  installRefreshPolicyDiagnostic,
} from "../lib/diagnostics.js";
import {
  readJsonFileOrNull,
  readJsonLinesFile,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import {
  buildExtensionInstallActions,
  executeExtensionInstallAction,
  type NativeInstallResult,
} from "../host-adapters/extension-installer.js";
import { resolveHostAdapter } from "../host-adapters/registry.js";
import { getOptionValue } from "../lib/cli-options.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runNativeInstallPreflight,
} from "../lib/preflight.js";
import {
  assertAssetCatalogEntry,
  assertBundleLock,
  assertInstallGenerationManifest,
  assertInstallProgressState,
  assertInstallRefreshState,
  assertInstalledPackageManifest,
  assertMirrorAcquireState,
  assertMirrorIndexEntry,
} from "../manifest-validation.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  InstallGenerationManifest,
  InstallProgressState,
  InstallRefreshAssetStatus,
  InstallRefreshHostSummary,
  InstallRefreshPolicy,
  InstallRefreshPolicyDecision,
  InstallRefreshReport,
  InstallRefreshState,
  InstallRefreshTier,
  MirrorIndexEntry,
  InstalledPackageManifest,
  MirrorAcquireState,
} from "../types.js";
import { acquireMirrorArtifacts } from "../mirror/acquire.js";
import { MIRROR_ACQUIRE_STATE_OUTPUT_PATH } from "../mirror/constants.js";
import { sanitizeMirrorId } from "../mirror/paths.js";
import { installBundles } from "./bundle.js";
import {
  INSTALL_GENERATIONS_ROOT,
  INSTALL_PROGRESS_STATE_OUTPUT_PATH,
  INSTALL_REFRESH_REPORT_OUTPUT_PATH,
  INSTALL_REFRESH_STATE_OUTPUT_PATH,
  NATIVE_INSTALL_STATE_OUTPUT_PATH,
} from "./paths.js";
import { INSTALL_HOSTS } from "./utils.js";

const MAX_REFRESH_BATCHES = 200;
const REVIEW_REQUIRED_AUTHORITY_TIERS = new Set([
  "unverified-community",
] as const);
const RISKY_EXECUTABLE_ASSET_KINDS = new Set([
  "extension",
  "hook",
  "mcp-server",
  "plugin",
] as const);
const INSTALL_REFRESH_POLICIES = [
  "manual",
  "report-only",
  "apply-safe",
] as const satisfies readonly InstallRefreshPolicy[];

/**
 * Generates or applies install refresh state for the lifecycle pipeline.
 */
export async function manageInstallRefresh(
  projectRoot: string,
  workingDirectory: string,
  args: string[],
): Promise<void> {
  const requestedHost = parseInstallHost(getOptionValue(args, "--host"));
  const hosts = requestedHost ? [requestedHost] : [...INSTALL_HOSTS];
  const installConfig = getRuntimeConfig().install;
  const refreshPolicy = installConfig.refreshPolicy;
  const refreshIntervalMs = installConfig.refreshIntervalMs;
  const applyRequested = args.includes("--apply");
  const dueOnly = args.includes("--due-only");
  const refreshedMirrorState = shouldRefreshMirrorState(args);
  const previousRefreshState = await loadInstallRefreshState(projectRoot);

  if (
    dueOnly &&
    previousRefreshState &&
    !isInstallRefreshDue(previousRefreshState, refreshPolicy, refreshIntervalMs)
  ) {
    console.log(
      `Install refresh is not due until ${previousRefreshState.nextCheckAt}.`,
    );
    return;
  }

  await refreshMirrorStateIfRequested(
    refreshedMirrorState,
    projectRoot,
    workingDirectory,
  );

  let report = await buildInstallRefreshReport(
    projectRoot,
    hosts,
    refreshPolicy,
    refreshedMirrorState,
  );
  await writeJsonFile(join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH), report);
  printInstallRefreshReport(projectRoot, report, false);

  const bundleIdsToRefresh = collectRefreshBundleIds(report, [
    "apply",
    "stage-only",
  ]);
  const nativeRefreshExtensionIds = collectNativeRefreshExtensionIds(report);
  let applied = false;

  if (applyRequested) {
    if (
      bundleIdsToRefresh.length === 0 &&
      nativeRefreshExtensionIds.size === 0
    ) {
      console.log("No stale install bundles were eligible for refresh apply.");
    } else {
      await applyBundleRefreshes(projectRoot, bundleIdsToRefresh);
      await applyNativeRefreshes(projectRoot, nativeRefreshExtensionIds);
      applied = true;

      const appliedAssetActions = collectAppliedAssetActions(report);
      report = await buildInstallRefreshReport(
        projectRoot,
        hosts,
        refreshPolicy,
        refreshedMirrorState,
      );
      report = applyRefreshActionAnnotations(report, appliedAssetActions);
      await writeJsonFile(
        join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
        report,
      );
      printInstallRefreshReport(projectRoot, report, true);
    }
  }

  await writeInstallRefreshState(projectRoot, previousRefreshState, report, {
    policy: refreshPolicy,
    intervalMs: refreshIntervalMs,
    refreshedMirrorState,
    applied,
  });
}

async function loadInstallRefreshState(
  projectRoot: string,
): Promise<InstallRefreshState | null> {
  return readJsonFileOrNull<InstallRefreshState>(
    join(projectRoot, ...INSTALL_REFRESH_STATE_OUTPUT_PATH),
    assertInstallRefreshState,
  );
}

function isInstallRefreshDue(
  previousState: InstallRefreshState | null,
  refreshPolicy: InstallRefreshPolicy,
  intervalMs: number,
): boolean {
  if (!previousState) {
    return true;
  }
  if (
    previousState.policy !== refreshPolicy ||
    previousState.intervalMs !== intervalMs
  ) {
    return true;
  }

  const nextCheckAtMs = Date.parse(previousState.nextCheckAt);
  if (!Number.isFinite(nextCheckAtMs)) {
    return true;
  }

  return nextCheckAtMs <= Date.now();
}

async function writeInstallRefreshState(
  projectRoot: string,
  previousState: InstallRefreshState | null,
  report: InstallRefreshReport,
  options: {
    policy: InstallRefreshPolicy;
    intervalMs: number;
    refreshedMirrorState: boolean;
    applied: boolean;
  },
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const staleCount = report.hosts.reduce((count, host) => count + host.staleCount, 0);
  const stageEligibleCount = report.hosts.reduce(
    (count, host) => count + host.stageEligibleCount,
    0,
  );
  const applyEligibleCount = report.hosts.reduce(
    (count, host) => count + host.applyEligibleCount,
    0,
  );
  const reviewRequiredCount = report.hosts.reduce(
    (count, host) => count + host.reviewRequiredCount,
    0,
  );
  const quarantinedCount = report.hosts.reduce(
    (count, host) => count + host.quarantinedCount,
    0,
  );
  await writeJsonFile(join(projectRoot, ...INSTALL_REFRESH_STATE_OUTPUT_PATH), {
    schemaVersion: 1,
    updatedAt,
    policy: options.policy,
    intervalMs: options.intervalMs,
    nextCheckAt: new Date(Date.now() + options.intervalMs).toISOString(),
    lastAppliedAt: options.applied
      ? updatedAt
      : previousState?.lastAppliedAt,
    refreshedMirrorState: options.refreshedMirrorState,
    staleCount,
    stageEligibleCount,
    applyEligibleCount,
    reviewRequiredCount,
    quarantinedCount,
  } satisfies InstallRefreshState);
}

function parseInstallHost(value: string | undefined): (typeof INSTALL_HOSTS)[number] | undefined {
  if (!value) {
    return undefined;
  }

  if (!INSTALL_HOSTS.includes(value as (typeof INSTALL_HOSTS)[number])) {
    throw new Error(
      `Invalid --host value '${value}'. Must be one of: ${INSTALL_HOSTS.join(", ")}`,
    );
  }

  return value as (typeof INSTALL_HOSTS)[number];
}

interface RefreshMirrorStateOptions {
  acquire?: typeof acquireMirrorArtifacts;
  maxBatches?: number;
  readAcquireState?: () => Promise<MirrorAcquireState | null>;
}

interface ApplyBundleRefreshesOptions {
  install?: typeof installBundles;
  maxBatches?: number;
  readProgressState?: () => Promise<InstallProgressState | null>;
}

function shouldRefreshMirrorState(args: readonly string[]): boolean {
  return !args.includes("--no-mirror-refresh");
}

async function refreshMirrorStateIfRequested(
  shouldRefresh: boolean,
  projectRoot: string,
  workingDirectory: string,
  refresh: typeof refreshMirrorState = refreshMirrorState,
): Promise<void> {
  if (shouldRefresh) {
    await refresh(projectRoot, workingDirectory);
  }
}

async function refreshMirrorState(
  projectRoot: string,
  workingDirectory: string,
  options: RefreshMirrorStateOptions = {},
): Promise<void> {
  const batchSize = String(getRuntimeConfig().batches.mirrorAcquire);
  const acquire = options.acquire ?? acquireMirrorArtifacts;
  const maxBatches = options.maxBatches ?? MAX_REFRESH_BATCHES;
  const readAcquireState =
    options.readAcquireState ??
    (() =>
      readJsonFileOrNull<MirrorAcquireState>(
        join(projectRoot, ...MIRROR_ACQUIRE_STATE_OUTPUT_PATH),
        assertMirrorAcquireState,
      ));

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    await acquire(projectRoot, workingDirectory, [
      "--refresh",
      "--batch-size",
      batchSize,
    ]);
    const acquireState = await readAcquireState();
    if (acquireState?.terminal) {
      return;
    }
  }

  throw new Error("mirror refresh did not complete within the maximum batch count");
}

async function buildInstallRefreshReport(
  projectRoot: string,
  hosts: readonly (typeof INSTALL_HOSTS)[number][],
  refreshPolicy: InstallRefreshPolicy,
  refreshedMirrorState: boolean,
): Promise<InstallRefreshReport> {
  const mirrorIndexEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, "mirror", "index.jsonl"),
    assertMirrorIndexEntry,
  );
  const mirrorIndexById = new Map(
    mirrorIndexEntries.map((entry) => [entry.mirrorId, entry]),
  );

  const hostSummaries = await Promise.all(
    hosts.map((host) =>
      buildInstallRefreshHostSummary(
        projectRoot,
        host,
        refreshPolicy,
        mirrorIndexById,
      ),
    ),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: refreshPolicy,
    refreshedMirrorState,
    hosts: hostSummaries,
  };
}

async function buildInstallRefreshHostSummary(
  projectRoot: string,
  host: (typeof INSTALL_HOSTS)[number],
  refreshPolicy: InstallRefreshPolicy,
  mirrorIndexById: Map<string, MirrorIndexEntry>,
): Promise<InstallRefreshHostSummary> {
  const currentGeneration = await readJsonFileOrNull<InstallGenerationManifest>(
    join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host, "current.json"),
    assertInstallGenerationManifest,
  );
  if (!currentGeneration) {
    return {
      host,
      pinnedGeneration: false,
      assetCount: 0,
      staleCount: 0,
      pinnedCount: 0,
      blockedCount: 0,
      currentCount: 0,
      stageEligibleCount: 0,
      applyEligibleCount: 0,
      reviewRequiredCount: 0,
      quarantinedCount: 0,
      assets: [],
    };
  }

  const bundleLocks = await Promise.all(
    currentGeneration.bundleIds.map(async (bundleId) => {
      const bundleLock = await readJsonFileOrNull<BundleLock>(
        join(projectRoot, "mirror", "bundles", `${bundleId}.lock.json`),
        assertBundleLock,
      );
      return bundleLock;
    }),
  );
  const bundleAssetsByAssetId = new Map<
    string,
    { mirrorIds: string[]; bundleIds: string[] }
  >();
  for (const bundleLock of bundleLocks) {
    if (!bundleLock) {
      continue;
    }
    for (const asset of bundleLock.assets) {
      const existing = bundleAssetsByAssetId.get(asset.assetId);
      if (existing) {
        existing.bundleIds = [...new Set([...existing.bundleIds, bundleLock.bundleId])].sort(
          (left, right) => left.localeCompare(right),
        );
        existing.mirrorIds = [...new Set([...existing.mirrorIds, asset.mirrorId])].sort(
          (left, right) => left.localeCompare(right),
        );
      } else {
        bundleAssetsByAssetId.set(asset.assetId, {
          mirrorIds: [asset.mirrorId],
          bundleIds: [bundleLock.bundleId],
        });
      }
    }
  }

  const packageManifests = await Promise.all(
    currentGeneration.packageManifestPaths.map((manifestPath) =>
      readJsonFileOrNull<InstalledPackageManifest>(
        manifestPath,
        assertInstalledPackageManifest,
      ),
    ),
  );
  const assets = (
    await Promise.all(
      packageManifests
        .filter(
          (manifest): manifest is InstalledPackageManifest => manifest !== null,
        )
        .map((manifest) =>
          buildInstallRefreshAssetStatus(
            projectRoot,
            host,
            manifest,
            currentGeneration.pinned ?? false,
            bundleAssetsByAssetId,
            mirrorIndexById,
            refreshPolicy,
          ),
        ),
    )
  ).sort((left, right) => left.assetId.localeCompare(right.assetId));

  return {
    host,
    pinnedGeneration: currentGeneration.pinned ?? false,
    assetCount: assets.length,
    staleCount: assets.filter((asset) => asset.status === "stale").length,
    pinnedCount: assets.filter((asset) => asset.status === "pinned").length,
    blockedCount: assets.filter((asset) => asset.status === "blocked").length,
    currentCount: assets.filter((asset) => asset.status === "current").length,
    stageEligibleCount: assets.filter(
      (asset) => asset.policyDecision === "stage-only",
    ).length,
    applyEligibleCount: assets.filter((asset) => asset.policyDecision === "apply")
      .length,
    reviewRequiredCount: assets.filter(
      (asset) => asset.policyDecision === "review-required",
    ).length,
    quarantinedCount: assets.filter(
      (asset) => asset.policyDecision === "blocked-quarantined",
    ).length,
    assets,
  };
}

async function buildInstallRefreshAssetStatus(
  projectRoot: string,
  host: (typeof INSTALL_HOSTS)[number],
  manifest: InstalledPackageManifest,
  pinnedGeneration: boolean,
  bundleAssetsByAssetId: Map<string, { mirrorIds: string[]; bundleIds: string[] }>,
  mirrorIndexById: Map<string, MirrorIndexEntry>,
  refreshPolicy: InstallRefreshPolicy,
): Promise<InstallRefreshAssetStatus> {
  const latestBundleAsset = bundleAssetsByAssetId.get(manifest.assetId);
  const hasMirrorConflict = (latestBundleAsset?.mirrorIds.length ?? 0) > 1;
  const latestMirrorId =
    latestBundleAsset?.mirrorIds.length === 1
      ? latestBundleAsset.mirrorIds[0]
      : undefined;
  const latestMirrorEntry = latestMirrorId
    ? mirrorIndexById.get(latestMirrorId)
    : undefined;
  const latestCatalogEntry = latestMirrorEntry
    ? await readJsonFileOrNull<AssetCatalogEntry>(
        join(
          projectRoot,
          "mirror",
          "raw",
          sanitizeMirrorId(latestMirrorEntry.mirrorId),
          "asset.json",
        ),
        assertAssetCatalogEntry,
      )
    : null;

  let status: InstallRefreshAssetStatus["status"];
  let reason: string;

  if (pinnedGeneration) {
    status = "pinned";
    reason = "Current install generation is pinned.";
  } else if (!latestBundleAsset) {
    status = "blocked";
    reason = "Asset is no longer present in the current bundle lock set.";
  } else if (hasMirrorConflict) {
    status = "blocked";
    reason = `Asset is referenced by conflicting bundle lock mirrors: ${latestBundleAsset.mirrorIds.join(", ")}.`;
  } else if (latestMirrorEntry?.status === "quarantined") {
    status = "blocked";
    reason = `Latest mirror ${latestMirrorId} is quarantined and cannot be refreshed automatically.`;
  } else if (latestMirrorId !== manifest.mirrorId) {
    status = "stale";
    reason = `Installed mirror ${manifest.mirrorId} differs from latest mirror ${latestMirrorId}.`;
  } else {
    status = "current";
    reason = "Installed mirror matches the latest bundle lock mirror.";
  }

  const refreshPolicyDecision = decideInstallRefreshPolicy(
    status,
    refreshPolicy,
    manifest,
    latestMirrorEntry,
    latestCatalogEntry,
  );

  return {
    assetId: manifest.assetId,
    host,
    bundleIds: latestBundleAsset?.bundleIds ?? [...manifest.bundleMembership],
    assetKind: manifest.assetKind,
    status,
    policyDecision: refreshPolicyDecision.decision,
    pinned: pinnedGeneration,
    reason,
    refreshTier: refreshPolicyDecision.tier,
    policyReason: refreshPolicyDecision.reason,
    installedMirrorId: manifest.mirrorId,
    latestMirrorId,
    installedFingerprint: manifest.upstream,
    latestFingerprint:
      latestMirrorEntry && latestCatalogEntry
        ? {
            mirrorId: latestMirrorEntry.mirrorId,
            mirroredAt: latestMirrorEntry.mirroredAt,
            sourceId: latestCatalogEntry.source.sourceId,
            sourceOriginUrl: latestCatalogEntry.source.originUrl,
            sourceLastUpdated: latestCatalogEntry.maintenance.lastUpdated,
            upstream: latestMirrorEntry.upstream,
          }
        : undefined,
    nativeInstall:
      manifest.nativeInstall?.extensionId && status === "stale"
        ? {
            extensionId: manifest.nativeInstall.extensionId,
            operation: "install",
          }
        : undefined,
  };
}

interface InstallRefreshPolicyResult {
  decision: InstallRefreshPolicyDecision;
  tier: InstallRefreshTier;
  reason: string;
}

function decideInstallRefreshPolicy(
  status: InstallRefreshAssetStatus["status"],
  refreshPolicy: InstallRefreshPolicy,
  manifest?: InstalledPackageManifest,
  latestMirrorEntry?: MirrorIndexEntry,
  latestCatalogEntry?: AssetCatalogEntry | null,
): InstallRefreshPolicyResult {
  if (status === "current") {
    return {
      decision: "ignore",
      tier: "auto-report-only",
      reason: "Installed asset is current.",
    };
  }
  if (status === "pinned") {
    return {
      decision: "ignore",
      tier: "auto-report-only",
      reason: "Pinned install generations are never refreshed automatically.",
    };
  }
  if (latestMirrorEntry?.status === "quarantined") {
    return {
      decision: "blocked-quarantined",
      tier: "blocked-quarantined",
      reason: "Latest mirror is quarantined and requires review before refresh.",
    };
  }
  if (status === "blocked" || status === "unknown") {
    return {
      decision: "review-required",
      tier: "review-required",
      reason: "Refresh cannot prove a single safe replacement.",
    };
  }
  if (refreshPolicy === "manual") {
    return {
      decision: "notify",
      tier: "auto-report-only",
      reason: "Manual policy reports stale assets without staging or applying.",
    };
  }
  if (refreshPolicy === "report-only") {
    return {
      decision: "plan",
      tier: "auto-report-only",
      reason: "Report-only policy plans refresh work without mutating install state.",
    };
  }
  if (requiresRefreshReview(manifest, latestMirrorEntry, latestCatalogEntry)) {
    return {
      decision: "review-required",
      tier: "review-required",
      reason:
        "Trust, risk, host compatibility, or executable behavior requires review before refresh.",
    };
  }
  if (isStageOnlyRefresh(manifest, latestCatalogEntry)) {
    return {
      decision: "stage-only",
      tier: "auto-stage",
      reason:
        "Asset can be staged safely, but activation/native install remains review-gated.",
    };
  }
  return {
    decision: "apply",
    tier: "auto-refresh-low-risk",
    reason: "Low-risk refresh is eligible for apply-safe updates.",
  };
}

function requiresRefreshReview(
  manifest: InstalledPackageManifest | undefined,
  latestMirrorEntry: MirrorIndexEntry | undefined,
  latestCatalogEntry: AssetCatalogEntry | null | undefined,
): boolean {
  if (!manifest || !latestMirrorEntry || !latestCatalogEntry) {
    return true;
  }
  if (latestMirrorEntry.status !== "approved") {
    return true;
  }
  if (manifest.sourceAuthorityTier !== latestMirrorEntry.source.authorityTier) {
    return true;
  }
  if (
    REVIEW_REQUIRED_AUTHORITY_TIERS.has(
      latestMirrorEntry.source.authorityTier as "unverified-community",
    )
  ) {
    return true;
  }
  if (!latestMirrorEntry.source.publisherVerified) {
    return true;
  }
  if (!latestCatalogEntry.hosts.includes(manifest.host)) {
    return true;
  }
  if (!latestCatalogEntry.status.installEligible) {
    return true;
  }
  if (latestCatalogEntry.risk.level !== "low") {
    return true;
  }
  if (latestCatalogEntry.risk.hasHooks || latestCatalogEntry.risk.hasExecScripts) {
    return true;
  }
  if (manifest.assetKind !== latestCatalogEntry.assetKind) {
    return true;
  }
  return false;
}

function isStageOnlyRefresh(
  manifest: InstalledPackageManifest | undefined,
  latestCatalogEntry: AssetCatalogEntry | null | undefined,
): boolean {
  if (!manifest || !latestCatalogEntry) {
    return false;
  }
  if (
    RISKY_EXECUTABLE_ASSET_KINDS.has(
      latestCatalogEntry.assetKind as "extension" | "hook" | "mcp-server" | "plugin",
    )
  ) {
    return true;
  }
  if (manifest.activationEligible || latestCatalogEntry.status.activationEligible) {
    return true;
  }
  return false;
}

function collectRefreshBundleIds(
  report: InstallRefreshReport,
  decisions: readonly InstallRefreshPolicyDecision[],
): string[] {
  const decisionSet = new Set(decisions);
  return [
    ...new Set(
      report.hosts.flatMap((host) =>
        host.assets
          .filter(
            (asset) => asset.status === "stale" && decisionSet.has(asset.policyDecision),
          )
          .flatMap((asset) => asset.bundleIds),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function collectAppliedAssetActions(
  report: InstallRefreshReport,
): Map<string, "refreshed" | "staged"> {
  const actions = new Map<string, "refreshed" | "staged">();
  for (const host of report.hosts) {
    for (const asset of host.assets) {
      if (asset.status !== "stale") {
        continue;
      }
      if (asset.policyDecision === "apply") {
        actions.set(`${host.host}\0${asset.assetId}`, "refreshed");
      } else if (asset.policyDecision === "stage-only") {
        actions.set(`${host.host}\0${asset.assetId}`, "staged");
      }
    }
  }
  return actions;
}

function applyRefreshActionAnnotations(
  report: InstallRefreshReport,
  actions: Map<string, "refreshed" | "staged">,
): InstallRefreshReport {
  return {
    ...report,
    hosts: report.hosts.map((host) => ({
      ...host,
      assets: host.assets.map((asset) => ({
        ...asset,
        lastRefreshAction: actions.get(`${host.host}\0${asset.assetId}`) ?? "skipped",
      })),
    })),
  };
}

function collectNativeRefreshExtensionIds(
  report: InstallRefreshReport,
): Map<string, string[]> {
  const extensionIdsByHost = new Map<string, Set<string>>();

  for (const host of report.hosts) {
    for (const asset of host.assets) {
      if (
        asset.status !== "stale" ||
        asset.policyDecision !== "apply" ||
        !asset.nativeInstall?.extensionId
      ) {
        continue;
      }

      const hostExtensionIds =
        extensionIdsByHost.get(host.host) ?? new Set<string>();
      hostExtensionIds.add(asset.nativeInstall.extensionId);
      extensionIdsByHost.set(host.host, hostExtensionIds);
    }
  }

  return new Map(
    [...extensionIdsByHost.entries()].map(([host, extensionIds]) => [
      host,
      [...extensionIds].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

async function applyNativeRefreshes(
  projectRoot: string,
  extensionIdsByHost: Map<string, string[]>,
): Promise<void> {
  for (const [host, extensionIds] of extensionIdsByHost) {
    if (extensionIds.length === 0) {
      continue;
    }

    const adapter = resolveHostAdapter(host);
    if (!adapter?.nativeInstall || !adapter.runtime?.executable) {
      throw new Error(
        `Install refresh cannot apply native updates for host '${host}' because no native install provider is configured.`,
      );
    }

    const diagnostics = await runNativeInstallPreflight(adapter);
    if (diagnostics.length > 0) {
      console.log(formatPreflightDiagnostics(diagnostics));
    }
    assertNoPreflightErrors(diagnostics);

    const actions = buildExtensionInstallActions({
      executable: adapter.runtime.executable,
      extensionIds,
      host: adapter.id,
    });
    if (actions.length !== extensionIds.length) {
      throw new Error(
        `Install refresh cannot apply native updates for host '${host}' because one or more extension ids were invalid.`,
      );
    }

    const results: NativeInstallResult[] = [];
    for (const action of actions) {
      const result = await executeExtensionInstallAction(action, "install");
      results.push(result);
      console.log(
        `${result.success ? "ok" : "failed"}: ${result.message} (${result.extensionId})`,
      );
      if (!result.success) {
        throw new Error(
          `Native install refresh failed for ${result.extensionId} on ${adapter.displayName}.`,
        );
      }
    }

    await writeJsonFile(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH), {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      host: adapter.id,
      operation: "install",
      results,
    });
  }
}

async function applyBundleRefreshes(
  projectRoot: string,
  bundleIds: readonly string[],
  options: ApplyBundleRefreshesOptions = {},
): Promise<void> {
  const batchSize = String(getRuntimeConfig().batches.installBundle);
  const install = options.install ?? installBundles;
  const maxBatches = options.maxBatches ?? MAX_REFRESH_BATCHES;
  const readProgressState =
    options.readProgressState ??
    (() =>
      readJsonFileOrNull<InstallProgressState>(
        join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
        assertInstallProgressState,
      ));

  for (const bundleId of bundleIds) {
    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
      await install(projectRoot, ["--bundle", bundleId, "--batch-size", batchSize]);
      const progressState = await readProgressState();
      const bundleState = progressState?.bundles[bundleId];
      if (bundleState && bundleState.remainingAssets <= 0) {
        break;
      }
      if (batchIndex === maxBatches - 1) {
        throw new Error(
          `install refresh did not complete bundle '${bundleId}' within the maximum batch count`,
        );
      }
    }
  }
}

function printInstallRefreshReport(
  projectRoot: string,
  report: InstallRefreshReport,
  applied: boolean,
): void {
  const outputPath = toPosixPath(join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH));
  console.log(
    `${applied ? "Updated" : "Wrote"} install refresh report to ${outputPath}`,
  );
  for (const host of report.hosts) {
    console.log(
      `  ${host.host}: assets=${host.assetCount} stale=${host.staleCount} pinned=${host.pinnedCount} blocked=${host.blockedCount} current=${host.currentCount} stage=${host.stageEligibleCount} apply=${host.applyEligibleCount} review=${host.reviewRequiredCount} quarantined=${host.quarantinedCount}`,
    );
  }

  const policyDiagnostic = installRefreshPolicyDiagnostic(report);
  if (policyDiagnostic) {
    console.log(formatActionableDiagnostic(policyDiagnostic));
  }
}

/**
 * Exposes narrow install refresh internals for focused scheduling and apply tests.
 */
export const installRefreshInternals = {
  isInstallRefreshDue,
  parseInstallHost,
  shouldRefreshMirrorState,
  refreshMirrorStateIfRequested,
  refreshMirrorState,
  decideInstallRefreshPolicy,
  requiresRefreshReview,
  isStageOnlyRefresh,
  collectRefreshBundleIds,
  collectNativeRefreshExtensionIds,
  applyNativeRefreshes,
  applyBundleRefreshes,
};

/**
 * Exposes the supported install refresh policy values for CLI/config validation.
 */
export const installRefreshPolicies = [...INSTALL_REFRESH_POLICIES];

