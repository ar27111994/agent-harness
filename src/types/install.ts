import type { AssetContextCost } from "./catalog.js";
import type { AssetKind, AuthorityTier, HostTarget } from "./core.js";
import type { MirrorIndexEntry } from "./mirror.js";

/**
 * Defines install refresh policy values.
 */
export type InstallRefreshPolicy = "manual" | "report-only" | "apply-safe";

/**
 * Defines one installed upstream fingerprint captured at install time.
 */
export interface InstalledUpstreamFingerprint {
  mirrorId: string;
  mirroredAt: string;
  sourceId: string;
  sourceOriginUrl: string;
  sourceLastUpdated: string;
  upstream: MirrorIndexEntry["upstream"];
}

/**
 * Describes optional native-install identity recorded for one installed asset.
 */
export interface InstalledNativeInstallFingerprint {
  extensionId?: string;
}

/**
 * Describes installed package manifest data exchanged by the lifecycle pipeline.
 */
export interface InstalledPackageManifest {
  schemaVersion: number;
  assetId: string;
  mirrorId: string;
  host: HostTarget;
  installedAt: string;
  projectionType: string;
  assetKind: AssetKind;
  sourceAuthorityTier: AuthorityTier;
  contextCost: AssetContextCost;
  portfolioFit: number;
  filesRoot: string;
  bundleMembership: string[];
  activationEligible: boolean;
  activeByDefault: boolean;
  upstream?: InstalledUpstreamFingerprint;
  nativeInstall?: InstalledNativeInstallFingerprint;
}

/**
 * Describes installed bundle manifest data exchanged by the lifecycle pipeline.
 */
export interface InstalledBundleManifest {
  schemaVersion: number;
  bundleId: string;
  host: HostTarget;
  installedAt: string;
  packages: Array<{
    assetId: string;
    mirrorId: string;
    manifestPath: string;
  }>;
}

/**
 * Describes install generation manifest data exchanged by the lifecycle pipeline.
 */
export interface InstallGenerationManifest {
  schemaVersion: number;
  generationId: string;
  host: HostTarget;
  generatedAt: string;
  bundleIds: string[];
  packageManifestPaths: string[];
  pinned?: boolean;
  pinReason?: string;
}

/**
 * Describes install progress state data exchanged by the lifecycle pipeline.
 */
export interface InstallProgressState {
  schemaVersion: number;
  updatedAt: string;
  bundles: Record<
    string,
    {
      host: HostTarget;
      batchSize: number;
      totalAssets: number;
      installedAssets: number;
      remainingAssets: number;
      lastBatchAssetIds: string[];
    }
  >;
}

/**
 * Defines install refresh status values.
 */
export type InstallRefreshStatus =
  | "current"
  | "stale"
  | "pinned"
  | "blocked"
  | "unknown";

/**
 * Defines install refresh policy-decision values.
 */
export type InstallRefreshPolicyDecision =
  | "ignore"
  | "notify"
  | "plan"
  | "apply";

/**
 * Describes one install refresh asset status entry.
 */
export interface InstallRefreshAssetStatus {
  assetId: string;
  host: HostTarget;
  bundleIds: string[];
  assetKind: AssetKind;
  status: InstallRefreshStatus;
  policyDecision: InstallRefreshPolicyDecision;
  pinned: boolean;
  reason: string;
  installedMirrorId: string;
  latestMirrorId?: string;
  installedFingerprint?: InstalledUpstreamFingerprint;
  latestFingerprint?: InstalledUpstreamFingerprint;
  nativeInstall?: {
    extensionId?: string;
    operation?: "install";
  };
}

/**
 * Describes one host-level install refresh summary.
 */
export interface InstallRefreshHostSummary {
  host: HostTarget;
  pinnedGeneration: boolean;
  assetCount: number;
  staleCount: number;
  pinnedCount: number;
  blockedCount: number;
  currentCount: number;
  assets: InstallRefreshAssetStatus[];
}

/**
 * Describes install refresh report data exchanged by the lifecycle pipeline.
 */
export interface InstallRefreshReport {
  schemaVersion: 1;
  generatedAt: string;
  policy: InstallRefreshPolicy;
  refreshedMirrorState: boolean;
  hosts: InstallRefreshHostSummary[];
}

/**
 * Describes persisted install refresh scheduling state.
 */
export interface InstallRefreshState {
  schemaVersion: 1;
  updatedAt: string;
  policy: InstallRefreshPolicy;
  intervalMs: number;
  nextCheckAt: string;
  lastAppliedAt?: string;
  refreshedMirrorState: boolean;
  staleCount: number;
  applyEligibleCount: number;
}
