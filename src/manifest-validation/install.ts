import type {
  InstallGenerationManifest,
  InstallProgressState,
  InstallRefreshReport,
  InstallRefreshState,
  InstalledBundleManifest,
  InstalledPackageManifest,
} from "../types.js";
import {
  ASSET_KINDS,
  AUTHORITY_TIERS,
  CONTEXT_COST_CLASSES,
  assertArray,
  assertBoolean,
  assertHostTarget,
  assertLiteral,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
} from "./primitives.js";

/**
 * Validates unknown data as installed package manifest.
 */
export function assertInstalledPackageManifest(
  value: unknown,
  context: string,
): asserts value is InstalledPackageManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.assetId, `${context}.assetId`);
  assertString(record.mirrorId, `${context}.mirrorId`);
  assertHostTarget(record.host, `${context}.host`);
  assertString(record.installedAt, `${context}.installedAt`);
  assertString(record.projectionType, `${context}.projectionType`);
  assertLiteral(record.assetKind, ASSET_KINDS, `${context}.assetKind`);
  assertLiteral(
    record.sourceAuthorityTier,
    AUTHORITY_TIERS,
    `${context}.sourceAuthorityTier`,
  );
  const contextCost = assertRecord(
    record.contextCost,
    `${context}.contextCost`,
  );
  assertLiteral(
    contextCost.sizeClass,
    [...CONTEXT_COST_CLASSES],
    `${context}.contextCost.sizeClass`,
  );
  assertNumber(
    contextCost.estimatedPromptWeight,
    `${context}.contextCost.estimatedPromptWeight`,
  );
  assertNumber(record.portfolioFit, `${context}.portfolioFit`);
  assertString(record.filesRoot, `${context}.filesRoot`);
  assertStringArray(record.bundleMembership, `${context}.bundleMembership`);
  assertBoolean(record.activationEligible, `${context}.activationEligible`);
  assertBoolean(record.activeByDefault, `${context}.activeByDefault`);
  if (record.upstream !== undefined) {
    assertInstalledUpstreamFingerprint(record.upstream, `${context}.upstream`);
  }
  if (record.nativeInstall !== undefined) {
    assertInstalledNativeInstallFingerprint(
      record.nativeInstall,
      `${context}.nativeInstall`,
    );
  }
}

/**
 * Validates unknown data as installed bundle manifest.
 */
export function assertInstalledBundleManifest(
  value: unknown,
  context: string,
): asserts value is InstalledBundleManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.bundleId, `${context}.bundleId`);
  assertHostTarget(record.host, `${context}.host`);
  assertString(record.installedAt, `${context}.installedAt`);
  assertArray(record.packages, `${context}.packages`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(entry, `${context}.packages[${index}]`);
      assertString(
        entryRecord.assetId,
        `${context}.packages[${index}].assetId`,
      );
      assertString(
        entryRecord.mirrorId,
        `${context}.packages[${index}].mirrorId`,
      );
      assertString(
        entryRecord.manifestPath,
        `${context}.packages[${index}].manifestPath`,
      );
    },
  );
}

/**
 * Validates unknown data as install generation manifest.
 */
export function assertInstallGenerationManifest(
  value: unknown,
  context: string,
): asserts value is InstallGenerationManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generationId, `${context}.generationId`);
  assertHostTarget(record.host, `${context}.host`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertStringArray(record.bundleIds, `${context}.bundleIds`);
  assertStringArray(
    record.packageManifestPaths,
    `${context}.packageManifestPaths`,
  );
  if (record.pinned !== undefined) {
    assertBoolean(record.pinned, `${context}.pinned`);
  }
  if (record.pinReason !== undefined) {
    assertString(record.pinReason, `${context}.pinReason`);
  }
}

/**
 * Validates unknown data as install progress state.
 */
export function assertInstallProgressState(
  value: unknown,
  context: string,
): asserts value is InstallProgressState {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.updatedAt, `${context}.updatedAt`);
  const bundles = assertRecord(record.bundles, `${context}.bundles`);
  for (const [bundleKey, bundleValue] of Object.entries(bundles)) {
    const bundleRecord = assertRecord(
      bundleValue,
      `${context}.bundles.${bundleKey}`,
    );
    assertHostTarget(bundleRecord.host, `${context}.bundles.${bundleKey}.host`);
    assertNumber(
      bundleRecord.batchSize,
      `${context}.bundles.${bundleKey}.batchSize`,
    );
    assertNumber(
      bundleRecord.totalAssets,
      `${context}.bundles.${bundleKey}.totalAssets`,
    );
    assertNumber(
      bundleRecord.installedAssets,
      `${context}.bundles.${bundleKey}.installedAssets`,
    );
    assertNumber(
      bundleRecord.remainingAssets,
      `${context}.bundles.${bundleKey}.remainingAssets`,
    );
    assertStringArray(
      bundleRecord.lastBatchAssetIds,
      `${context}.bundles.${bundleKey}.lastBatchAssetIds`,
    );
  }
}

/**
 * Validates unknown data as install refresh report.
 */
export function assertInstallRefreshReport(
  value: unknown,
  context: string,
): asserts value is InstallRefreshReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  if (record.schemaVersion !== 1) {
    throw new Error(`${context}.schemaVersion must be 1`);
  }
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertLiteral(
    record.policy,
    ["manual", "report-only", "apply-safe"],
    `${context}.policy`,
  );
  assertBoolean(record.refreshedMirrorState, `${context}.refreshedMirrorState`);
  assertArray(record.hosts, `${context}.hosts`).forEach((hostEntry, index) => {
    const hostRecord = assertRecord(hostEntry, `${context}.hosts[${index}]`);
    assertHostTarget(hostRecord.host, `${context}.hosts[${index}].host`);
    assertBoolean(
      hostRecord.pinnedGeneration,
      `${context}.hosts[${index}].pinnedGeneration`,
    );
    assertNumber(
      hostRecord.assetCount,
      `${context}.hosts[${index}].assetCount`,
    );
    assertNumber(
      hostRecord.staleCount,
      `${context}.hosts[${index}].staleCount`,
    );
    assertNumber(
      hostRecord.pinnedCount,
      `${context}.hosts[${index}].pinnedCount`,
    );
    assertNumber(
      hostRecord.blockedCount,
      `${context}.hosts[${index}].blockedCount`,
    );
    assertNumber(
      hostRecord.currentCount,
      `${context}.hosts[${index}].currentCount`,
    );
    assertArray(hostRecord.assets, `${context}.hosts[${index}].assets`).forEach(
      (assetEntry, assetIndex) => {
        const assetRecord = assertRecord(
          assetEntry,
          `${context}.hosts[${index}].assets[${assetIndex}]`,
        );
        assertString(
          assetRecord.assetId,
          `${context}.hosts[${index}].assets[${assetIndex}].assetId`,
        );
        assertHostTarget(
          assetRecord.host,
          `${context}.hosts[${index}].assets[${assetIndex}].host`,
        );
        assertStringArray(
          assetRecord.bundleIds,
          `${context}.hosts[${index}].assets[${assetIndex}].bundleIds`,
        );
        assertLiteral(
          assetRecord.assetKind,
          ASSET_KINDS,
          `${context}.hosts[${index}].assets[${assetIndex}].assetKind`,
        );
        assertLiteral(
          assetRecord.status,
          ["current", "stale", "pinned", "blocked", "unknown"],
          `${context}.hosts[${index}].assets[${assetIndex}].status`,
        );
        assertLiteral(
          assetRecord.policyDecision,
          ["ignore", "notify", "plan", "apply"],
          `${context}.hosts[${index}].assets[${assetIndex}].policyDecision`,
        );
        assertBoolean(
          assetRecord.pinned,
          `${context}.hosts[${index}].assets[${assetIndex}].pinned`,
        );
        assertString(
          assetRecord.reason,
          `${context}.hosts[${index}].assets[${assetIndex}].reason`,
        );
        assertString(
          assetRecord.installedMirrorId,
          `${context}.hosts[${index}].assets[${assetIndex}].installedMirrorId`,
        );
        if (assetRecord.latestMirrorId !== undefined) {
          assertString(
            assetRecord.latestMirrorId,
            `${context}.hosts[${index}].assets[${assetIndex}].latestMirrorId`,
          );
        }
        if (assetRecord.installedFingerprint !== undefined) {
          assertInstalledUpstreamFingerprint(
            assetRecord.installedFingerprint,
            `${context}.hosts[${index}].assets[${assetIndex}].installedFingerprint`,
          );
        }
        if (assetRecord.latestFingerprint !== undefined) {
          assertInstalledUpstreamFingerprint(
            assetRecord.latestFingerprint,
            `${context}.hosts[${index}].assets[${assetIndex}].latestFingerprint`,
          );
        }
        if (assetRecord.nativeInstall !== undefined) {
          assertInstalledNativeInstallFingerprint(
            assetRecord.nativeInstall,
            `${context}.hosts[${index}].assets[${assetIndex}].nativeInstall`,
            true,
          );
        }
      },
    );
  });
}

/**
 * Validates unknown data as an installed upstream fingerprint.
 */
function assertInstalledUpstreamFingerprint(
  value: unknown,
  context: string,
): void {
  const upstreamRecord = assertRecord(value, context);
  assertString(upstreamRecord.mirrorId, `${context}.mirrorId`);
  assertString(upstreamRecord.mirroredAt, `${context}.mirroredAt`);
  assertString(upstreamRecord.sourceId, `${context}.sourceId`);
  assertString(upstreamRecord.sourceOriginUrl, `${context}.sourceOriginUrl`);
  assertString(
    upstreamRecord.sourceLastUpdated,
    `${context}.sourceLastUpdated`,
  );
  const upstreamFingerprint = assertRecord(
    upstreamRecord.upstream,
    `${context}.upstream`,
  );
  assertLiteral(
    upstreamFingerprint.type,
    ["repo", "package", "marketplace", "docs", "local"],
    `${context}.upstream.type`,
  );
  assertString(upstreamFingerprint.url, `${context}.upstream.url`);
  if (upstreamFingerprint.ref !== undefined) {
    assertString(upstreamFingerprint.ref, `${context}.upstream.ref`);
  }
  if (upstreamFingerprint.commit !== undefined) {
    assertString(upstreamFingerprint.commit, `${context}.upstream.commit`);
  }
  if (upstreamFingerprint.version !== undefined) {
    assertString(upstreamFingerprint.version, `${context}.upstream.version`);
  }
}

function assertInstalledNativeInstallFingerprint(
  value: unknown,
  context: string,
  allowOperation = false,
): void {
  const nativeInstallRecord = assertRecord(value, context);
  if (nativeInstallRecord.extensionId !== undefined) {
    assertString(nativeInstallRecord.extensionId, `${context}.extensionId`);
  }
  if (allowOperation && nativeInstallRecord.operation !== undefined) {
    assertLiteral(
      nativeInstallRecord.operation,
      ["install"],
      `${context}.operation`,
    );
  }
}

/**
 * Validates unknown data as install refresh scheduling state.
 */
export function assertInstallRefreshState(
  value: unknown,
  context: string,
): asserts value is InstallRefreshState {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  if (record.schemaVersion !== 1) {
    throw new Error(`${context}.schemaVersion must be 1`);
  }
  assertString(record.updatedAt, `${context}.updatedAt`);
  assertLiteral(
    record.policy,
    ["manual", "report-only", "apply-safe"],
    `${context}.policy`,
  );
  assertNumber(record.intervalMs, `${context}.intervalMs`);
  assertString(record.nextCheckAt, `${context}.nextCheckAt`);
  if (record.lastAppliedAt !== undefined) {
    assertString(record.lastAppliedAt, `${context}.lastAppliedAt`);
  }
  assertBoolean(record.refreshedMirrorState, `${context}.refreshedMirrorState`);
  assertNumber(record.staleCount, `${context}.staleCount`);
  assertNumber(record.applyEligibleCount, `${context}.applyEligibleCount`);
}
