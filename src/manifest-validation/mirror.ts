import type {
  BundleLock,
  MirrorAcquireState,
  MirrorIndexEntry,
  MirrorPolicy,
} from "../types.js";
import {
  assertArray,
  assertAssetKindArray,
  assertBoolean,
  assertHostTarget,
  assertLiteral,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
  AUTHORITY_TIERS,
  MIRROR_STATUSES,
  UPSTREAM_TYPES,
} from "./primitives.js";

/**
 * Validates unknown data as mirror policy.
 */
export function assertMirrorPolicy(
  value: unknown,
  context: string,
): asserts value is MirrorPolicy {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  const selection = assertRecord(record.selection, `${context}.selection`);
  assertBoolean(
    selection.officialBeatsPopularity,
    `${context}.selection.officialBeatsPopularity`,
  );
  assertBoolean(
    selection.requirePinnedProvenance,
    `${context}.selection.requirePinnedProvenance`,
  );
  assertString(
    selection.communityDefaultPolicy,
    `${context}.selection.communityDefaultPolicy`,
  );
  const audit = assertRecord(record.audit, `${context}.audit`);
  assertBoolean(audit.alwaysAudit, `${context}.audit.alwaysAudit`);
  assertStringArray(audit.quarantineOn, `${context}.audit.quarantineOn`);
  assertRecord(record.store, `${context}.store`);
  assertArray(record.bundleTemplates, `${context}.bundleTemplates`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(
        entry,
        `${context}.bundleTemplates[${index}]`,
      );
      assertString(entryRecord.id, `${context}.bundleTemplates[${index}].id`);
      assertHostTarget(
        entryRecord.host,
        `${context}.bundleTemplates[${index}].host`,
      );
      assertAssetKindArray(
        entryRecord.assetKinds,
        `${context}.bundleTemplates[${index}].assetKinds`,
      );
    },
  );
}

/**
 * Validates unknown data as bundle lock.
 */
export function assertBundleLock(
  value: unknown,
  context: string,
): asserts value is BundleLock {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.bundleId, `${context}.bundleId`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertHostTarget(record.host, `${context}.host`);
  assertArray(record.assets, `${context}.assets`).forEach((entry, index) => {
    const entryRecord = assertRecord(entry, `${context}.assets[${index}]`);
    assertString(entryRecord.assetId, `${context}.assets[${index}].assetId`);
    assertString(entryRecord.mirrorId, `${context}.assets[${index}].mirrorId`);
    assertString(
      entryRecord.projectionType,
      `${context}.assets[${index}].projectionType`,
    );
    assertBoolean(
      entryRecord.activationEligible,
      `${context}.assets[${index}].activationEligible`,
    );
  });
}

/**
 * Validates unknown data as mirror index entry.
 */
export function assertMirrorIndexEntry(
  value: unknown,
  context: string,
): asserts value is MirrorIndexEntry {
  const record = assertRecord(value, context);
  assertString(record.mirrorId, `${context}.mirrorId`);
  assertString(record.assetId, `${context}.assetId`);
  const upstream = assertRecord(record.upstream, `${context}.upstream`);
  assertLiteral(upstream.type, [...UPSTREAM_TYPES], `${context}.upstream.type`);
  assertString(upstream.url, `${context}.upstream.url`);
  const source = assertRecord(record.source, `${context}.source`);
  assertLiteral(
    source.authorityTier,
    AUTHORITY_TIERS,
    `${context}.source.authorityTier`,
  );
  assertString(source.publisher, `${context}.source.publisher`);
  assertBoolean(
    source.publisherVerified,
    `${context}.source.publisherVerified`,
  );
  assertString(record.mirroredAt, `${context}.mirroredAt`);
  assertString(record.contentHash, `${context}.contentHash`);
  assertLiteral(record.status, [...MIRROR_STATUSES], `${context}.status`);
}

/**
 * Validates unknown data as mirror acquire state.
 */
export function assertMirrorAcquireState(
  value: unknown,
  context: string,
): asserts value is MirrorAcquireState {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.updatedAt, `${context}.updatedAt`);
  assertNumber(record.batchSize, `${context}.batchSize`);
  assertNumber(record.totalEligibleCount, `${context}.totalEligibleCount`);
  assertNumber(record.mirroredCount, `${context}.mirroredCount`);
  assertNumber(record.remainingCount, `${context}.remainingCount`);
  assertNumber(record.skippedCount, `${context}.skippedCount`);
  assertStringArray(record.skippedAssetIds, `${context}.skippedAssetIds`);
  if (record.skippedAssetReasons !== undefined) {
    const skippedAssetReasons = assertRecord(
      record.skippedAssetReasons,
      `${context}.skippedAssetReasons`,
    );
    Object.entries(skippedAssetReasons).forEach(([key, entryValue]) => {
      assertString(entryValue, `${context}.skippedAssetReasons.${key}`);
    });
  }
  assertStringArray(record.lastBatchAssetIds, `${context}.lastBatchAssetIds`);
  assertNumber(
    record.lastBatchMirroredCount,
    `${context}.lastBatchMirroredCount`,
  );
  assertNumber(
    record.lastBatchSkippedCount,
    `${context}.lastBatchSkippedCount`,
  );
  if (record.lastBatchSkippedReasons !== undefined) {
    const lastBatchSkippedReasons = assertRecord(
      record.lastBatchSkippedReasons,
      `${context}.lastBatchSkippedReasons`,
    );
    Object.entries(lastBatchSkippedReasons).forEach(([key, entryValue]) => {
      assertString(entryValue, `${context}.lastBatchSkippedReasons.${key}`);
    });
  }
  assertBoolean(record.terminal, `${context}.terminal`);
}
