import type { AssetKind, AuthorityTier, HostTarget } from "./core.js";

/**
 * Describes bundle template data exchanged by the lifecycle pipeline.
 */
export interface BundleTemplate {
  id: string;
  host: HostTarget;
  description: string;
  assetKinds: AssetKind[];
  defaultPromotion: string;
}

/**
 * Describes mirror policy data exchanged by the lifecycle pipeline.
 */
export interface MirrorPolicy {
  schemaVersion: number;
  selection: {
    officialBeatsPopularity: boolean;
    requirePinnedProvenance: boolean;
    communityDefaultPolicy: string;
  };
  audit: {
    alwaysAudit: boolean;
    quarantineOn: string[];
  };
  store: {
    root: string;
    rawDirectories: string[];
    normalizedDirectories: string[];
    bundlesDirectory: string;
    quarantineDirectory: string;
    auditDirectory: string;
  };
  bundleTemplates: BundleTemplate[];
}

/**
 * Describes mirror plan data exchanged by the lifecycle pipeline.
 */
export interface MirrorPlan {
  schemaVersion: number;
  generatedAt: string;
  inputs: {
    demandProfile: boolean;
    sourceIndex: boolean;
    catalogEntries: number;
    mirrorEligibleEntries: number;
    selectedCatalogEntries: number;
  };
  candidateBreakdown: {
    byHost: Record<string, number>;
    byAssetKind: Record<string, number>;
  };
  policies: {
    officialBeatsPopularity: boolean;
    communityDefaultPolicy: string;
    alwaysAudit: boolean;
  };
  bundleTemplates: BundleTemplate[];
  nextActions: string[];
}

/**
 * Describes selection duplicate decision data exchanged by the lifecycle pipeline.
 */
export interface SelectionDuplicateDecision {
  duplicateGroup: string;
  selectedAssetId: string;
  rejectedAssetIds: string[];
  selectionReason: string;
}

/**
 * Describes selection report data exchanged by the lifecycle pipeline.
 */
export interface SelectionReport {
  schemaVersion: number;
  generatedAt: string;
  inputCount: number;
  selectedCount: number;
  rejectedCount: number;
  duplicateDecisions: SelectionDuplicateDecision[];
  /**
   * Aggregate count of rejected assets grouped by rejection reason.
   * Covers 100% of rejected assets. Reason strings are stable identifiers
   * (not ephemeral log messages) so they can be used in tests and dashboards.
   *
   * Stable reason values:
   *   - "demand-relevance"  — entry had no term overlap with the demand profile
   *   - "duplicate"         — entry lost deduplication within its duplicate group
   *   - "source-cap"        — entry was dropped by the per-source entry cap
   */
  rejectionSummary: Record<string, number>;
  /**
   * Up to 20 sample rejected entries with their rejection reason, for spot-
   * checking without loading the full rejected-catalog.jsonl file.
   */
  sampleRejected: Array<{ assetId: string; reason: string }>;
  /**
   * Acceptance rate as a fraction 0–1 (selectedCount / inputCount).
   * 0 when inputCount is 0. Rounded to 4 decimal places for diagnostic use.
   */
  acceptanceRate: number;
  /**
   * Human-readable warning emitted when any single source contributes more
   * than 20% of the selected entries after the per-source cap is applied.
   * Absent when the selected set is well-diversified.
   */
  sourceDiversityWarning?: string;
}

/**
 * Describes bundle lock asset data exchanged by the lifecycle pipeline.
 */
export interface BundleLockAsset {
  assetId: string;
  mirrorId: string;
  projectionType: string;
  activationEligible: boolean;
  notes?: string;
}

/**
 * Describes bundle lock data exchanged by the lifecycle pipeline.
 */
export interface BundleLock {
  schemaVersion: number;
  bundleId: string;
  generatedAt: string;
  host: HostTarget;
  assets: BundleLockAsset[];
}

/**
 * Describes mirror index entry data exchanged by the lifecycle pipeline.
 */
export interface MirrorIndexEntry {
  mirrorId: string;
  assetId: string;
  upstream: {
    type: "repo" | "package" | "marketplace" | "docs" | "local";
    url: string;
    ref?: string;
    commit?: string;
    version?: string;
  };
  source: {
    authorityTier: AuthorityTier;
    publisher: string;
    publisherVerified: boolean;
  };
  mirroredAt: string;
  contentHash: string;
  projectionCandidates: Array<{
    host: HostTarget;
    projectionType: string;
  }>;
  status:
    | "approved"
    | "approved-with-warning"
    | "quarantined"
    | "metadata-only"
    | "reference-only";
  /**
   * Records the concrete safety signals that drove this entry's status at
   * acquisition time. Persisted so quarantine lifecycle reporting can derive
   * real transitions (prompt-injection, executable/community/high risk)
   * instead of guessing from coarse status alone. Optional for backward
   * compatibility with indexes written before signal capture.
   */
  quarantineSignals?: MirrorQuarantineSignals;
}

/**
 * Captures the safety signals that justified a mirror entry's quarantine or
 * warning status. Each flag maps to an observable acquisition-time check.
 */
export interface MirrorQuarantineSignals {
  promptInjection: boolean;
  executableRisk: boolean;
  communityRisk: boolean;
  highRisk: boolean;
}

/**
 * Describes mirror acquire state data exchanged by the lifecycle pipeline.
 */
export interface MirrorAcquireState {
  schemaVersion: number;
  updatedAt: string;
  batchSize: number;
  totalEligibleCount: number;
  mirroredCount: number;
  remainingCount: number;
  skippedCount: number;
  skippedAssetIds: string[];
  skippedAssetReasons?: Record<string, string>;
  lastBatchAssetIds: string[];
  lastBatchMirroredCount: number;
  lastBatchSkippedCount: number;
  lastBatchSkippedReasons?: Record<string, string>;
  sessionMode?: "acquire" | "refresh";
  processedCount?: number;
  terminal: boolean;
}
