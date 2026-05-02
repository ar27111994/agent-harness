import type { AssetContextCost } from "./catalog.js";
import type { AssetKind, AuthorityTier, HostTarget } from "./core.js";

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
