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
  terminal: boolean;
}
