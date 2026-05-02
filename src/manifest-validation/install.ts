import type {
  InstallGenerationManifest,
  InstallProgressState,
  InstalledBundleManifest,
  InstalledPackageManifest,
} from "../types.js";
import {
  ASSET_KINDS,
  assertArray,
  assertBoolean,
  assertLiteral,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
  HOST_TARGETS,
} from "./primitives.js";

export function assertInstalledPackageManifest(
  value: unknown,
  context: string,
): asserts value is InstalledPackageManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.assetId, `${context}.assetId`);
  assertString(record.mirrorId, `${context}.mirrorId`);
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
  assertString(record.installedAt, `${context}.installedAt`);
  assertLiteral(record.assetKind, ASSET_KINDS, `${context}.assetKind`);
  assertString(record.filesRoot, `${context}.filesRoot`);
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
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
  assertString(record.installedAt, `${context}.installedAt`);
  assertArray(record.packages, `${context}.packages`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(entry, `${context}.packages[${index}]`);
      assertString(
        entryRecord.assetId,
        `${context}.packages[${index}].assetId`,
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
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
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
  assertRecord(record.bundles, `${context}.bundles`);
}
