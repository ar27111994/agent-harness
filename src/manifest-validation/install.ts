import type {
  InstallGenerationManifest,
  InstallProgressState,
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
}

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
