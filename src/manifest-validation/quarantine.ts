import type { QuarantineStateReport } from "../types.js";
import {
  AUTHORITY_TIERS,
  MIRROR_STATUSES,
  assertArray,
  assertBoolean,
  assertLiteral,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
} from "./primitives.js";

const QUARANTINE_TRANSITIONS = [
  "new-risky-asset",
  "safe-to-risky",
  "ownership-changed",
  "prompt-injection-detected",
  "prompt-injection-cleared",
  "safer-update-available",
  "installed-asset-became-risky",
  "official-duplicate-supersedes-community",
  "review-approved",
  "review-rejected",
  "review-pinned",
] as const;

/**
 * Validates unknown data as a quarantine lifecycle report.
 */
export function assertQuarantineStateReport(
  value: unknown,
  context: string,
): asserts value is QuarantineStateReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  if (record.schemaVersion !== 1) {
    throw new Error(`${context}.schemaVersion must be 1`);
  }
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertArray(record.entries, `${context}.entries`).forEach((entry, index) => {
    const entryRecord = assertRecord(entry, `${context}.entries[${index}]`);
    assertString(entryRecord.assetId, `${context}.entries[${index}].assetId`);
    assertString(entryRecord.mirrorId, `${context}.entries[${index}].mirrorId`);
    assertLiteral(
      entryRecord.currentState,
      MIRROR_STATUSES,
      `${context}.entries[${index}].currentState`,
    );
    assertString(entryRecord.reason, `${context}.entries[${index}].reason`);
    assertString(
      entryRecord.firstSeenAt,
      `${context}.entries[${index}].firstSeenAt`,
    );
    if (entryRecord.lastReviewedAt !== undefined) {
      assertString(
        entryRecord.lastReviewedAt,
        `${context}.entries[${index}].lastReviewedAt`,
      );
    }
    assertLiteral(
      entryRecord.suggestedAction,
      ["review", "keep-quarantined", "approve", "reject", "pin"],
      `${context}.entries[${index}].suggestedAction`,
    );
    assertStringArray(
      entryRecord.transitions,
      `${context}.entries[${index}].transitions`,
    ).forEach((transition, transitionIndex) => {
      assertLiteral(
        transition,
        QUARANTINE_TRANSITIONS,
        `${context}.entries[${index}].transitions[${transitionIndex}]`,
      );
    });
    assertString(
      entryRecord.upstreamUrl,
      `${context}.entries[${index}].upstreamUrl`,
    );
    assertLiteral(
      entryRecord.authorityTier,
      AUTHORITY_TIERS,
      `${context}.entries[${index}].authorityTier`,
    );
    assertString(
      entryRecord.publisher,
      `${context}.entries[${index}].publisher`,
    );
    assertBoolean(
      entryRecord.publisherVerified,
      `${context}.entries[${index}].publisherVerified`,
    );
    assertString(
      entryRecord.contentHash,
      `${context}.entries[${index}].contentHash`,
    );
  });

  const summary = assertRecord(record.summary, `${context}.summary`);
  assertNumber(summary.quarantinedCount, `${context}.summary.quarantinedCount`);
  assertNumber(
    summary.approvedWithWarningCount,
    `${context}.summary.approvedWithWarningCount`,
  );
  assertNumber(summary.rejectedCount, `${context}.summary.rejectedCount`);
  assertNumber(summary.pinnedCount, `${context}.summary.pinnedCount`);
  assertNumber(
    summary.reviewRequiredCount,
    `${context}.summary.reviewRequiredCount`,
  );
}
