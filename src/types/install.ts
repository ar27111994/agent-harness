import type { AssetContextCost } from "./catalog.js";
import type { AssetKind, AuthorityTier, HostTarget } from "./core.js";

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
