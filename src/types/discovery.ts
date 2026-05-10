import type {
  AssetKind,
  AuthorityTier,
  HostTarget,
  SourceKind,
} from "./core.js";

/**
 * Describes source publisher data exchanged by the lifecycle pipeline.
 */
export interface SourcePublisher {
  name: string;
  verified?: boolean;
  owner?: string;
}

/**
 * Describes source rules data exchanged by the lifecycle pipeline.
 */
export interface SourceRules {
  officialPreferred: boolean;
  allowMirror: boolean;
  allowInstall: boolean;
}

/**
 * Describes source definition data exchanged by the lifecycle pipeline.
 */
export interface SourceDefinition {
  id: string;
  name: string;
  kind: SourceKind;
  authorityTier: AuthorityTier;
  publisher?: SourcePublisher;
  hosts: HostTarget[];
  assetKinds: AssetKind[];
  discoveryMode: "catalog" | "seed";
  priority: number;
  enabled: boolean;
  endpoints: Record<string, string>;
  rules: SourceRules;
}

/**
 * Describes source registry data exchanged by the lifecycle pipeline.
 */
export interface SourceRegistry {
  $schema?: string;
  schemaVersion: number;
  sources: SourceDefinition[];
}

/**
 * Describes selection policies data exchanged by the lifecycle pipeline.
 */
export interface SelectionPolicies {
  officialBeatsPopularity: boolean;
  starsAreTieBreakerOnly: boolean;
  preferNativeOverAdaptable: boolean;
  preferLowerRiskWhenEquivalent: boolean;
  preferLowerContextCostWhenEquivalent: boolean;
  communityDefaultPolicy: "catalog-only-unless-promoted";
}

/**
 * Describes duplicate group data exchanged by the lifecycle pipeline.
 */
export interface DuplicateGroup {
  id: string;
  capability: string;
  preferredAuthorityTier: AuthorityTier | string;
  selectionReason: string;
}

/**
 * Describes selection registry data exchanged by the lifecycle pipeline.
 */
export interface SelectionRegistry {
  $schema?: string;
  schemaVersion: number;
  selectionPolicies: SelectionPolicies;
  rankingOrder: string[];
  duplicateGroups: DuplicateGroup[];
}

/**
 * Describes demand signal set data exchanged by the lifecycle pipeline.
 */
export interface DemandSignalSet {
  languages: string[];
  packageManagers: string[];
  frameworks: string[];
  concerns: string[];
  tooling: string[];
}

/**
 * Describes demand evidence strength shared by the lifecycle pipeline.
 */
export type DemandEvidenceStrength = "strong" | "medium" | "weak";

/**
 * Describes demand evidence data exchanged by the lifecycle pipeline.
 */
export interface DemandEvidence {
  path: string;
  fileName: string;
  evidenceStrength?: DemandEvidenceStrength;
  matchedSignals: DemandSignalSet;
}

/**
 * Describes demand profile data exchanged by the lifecycle pipeline.
 */
export interface DemandProfile {
  schemaVersion: number;
  generatedAt: string;
  scanRoot: string;
  summary: {
    scannedFiles: number;
    matchedFiles: number;
    scanTruncated?: boolean;
    truncationReason?: string;
    scannedBytes?: number;
  };
  signals: DemandSignalSet;
  evidence: DemandEvidence[];
}

/**
 * Describes source index data exchanged by the lifecycle pipeline.
 */
export interface SourceIndex {
  schemaVersion: number;
  generatedAt: string;
  sourceCount: number;
  byAuthorityTier: Record<string, number>;
  byKind: Record<string, number>;
  hostCoverage: Record<string, number>;
  communityDefaultPolicy: string;
  enabledSources: Array<{
    id: string;
    kind: SourceKind;
    authorityTier: AuthorityTier;
    priority: number;
    hosts: HostTarget[];
  }>;
}

/**
 * Describes git hub repo snapshot data exchanged by the lifecycle pipeline.
 */
export interface GitHubRepoSnapshot {
  owner: string;
  repo: string;
  sourceId: string;
  fetchedAt: string;
  repoSummary: {
    name: string;
    fullName: string;
    description: string | null;
    defaultBranch: string;
    updatedAt: string | null;
    pushedAt: string | null;
    stars: number;
    language: string | null;
    topics: string[];
    archived: boolean;
    htmlUrl: string;
  };
  readme: {
    path: string;
    sha: string;
    size: number;
    htmlUrl: string | null;
    downloadUrl: string | null;
  } | null;
  tree: {
    sha: string;
    truncated: boolean;
    entries: Array<{
      path: string;
      type: string;
      size: number | null;
      sha: string;
    }>;
  };
}

/**
 * Describes AI enrichment execution mode data exchanged by the lifecycle pipeline.
 */
export type AiEnrichmentMode =
  | "off"
  | "manual"
  | "after-select"
  | "after-workspace"
  | "on-ambiguity"
  | "on-input-change"
  | "ci-only";

/**
 * Describes AI enrichment trigger data exchanged by the lifecycle pipeline.
 */
export type AiEnrichmentTrigger = "manual" | "after-select" | "after-workspace";

/**
 * Describes AI enrichment terminal status data exchanged by the lifecycle pipeline.
 */
export type AiEnrichmentStatus =
  | "disabled"
  | "skipped"
  | "completed"
  | "reused"
  | "failed";

/**
 * Describes bounded demand-evidence data included in AI enrichment input artifacts.
 */
export interface AiEnrichmentInputEvidence {
  fileName: string;
  path?: string;
  evidenceStrength?: DemandEvidenceStrength;
  matchedSignals: DemandSignalSet;
}

/**
 * Describes bounded selected-asset data included in AI enrichment input artifacts.
 */
export interface AiEnrichmentInputSelectedAsset {
  id: string;
  displayName: string;
  assetKind: AssetKind;
  hosts: HostTarget[];
  authorityTier: AuthorityTier;
  sourceId?: string;
  capabilities: string[];
}

/**
 * Describes AI enrichment input artifact data exchanged by the lifecycle pipeline.
 */
export interface AiEnrichmentInput {
  schemaVersion: 1;
  generatedAt: string;
  mode: AiEnrichmentMode;
  trigger: AiEnrichmentTrigger;
  explicit: boolean;
  interactive: boolean;
  ci: boolean;
  model: string;
  providerOrigin?: string;
  selectedAssetCount: number;
  includedSelectedAssetCount: number;
  evidenceItemCount: number;
  includedEvidenceItemCount: number;
  omissions: {
    selectedAssets: number;
    evidenceItems: number;
    capabilityValues: number;
    sourceIdentifiersRedacted: boolean;
    filePathsRedacted: boolean;
  };
  fingerprints: {
    demandProfileSha256: string | null;
    selectedCatalogSha256: string | null;
    configSha256: string;
    inputSha256: string;
  };
  demandSignals: DemandSignalSet | null;
  demandEvidence: AiEnrichmentInputEvidence[];
  selectedAssets: AiEnrichmentInputSelectedAsset[];
}

/**
 * Describes AI enrichment output/report artifact data exchanged by the lifecycle pipeline.
 */
export interface AiEnrichmentReport {
  schemaVersion: 1;
  generatedAt: string;
  enabled: boolean;
  mode: AiEnrichmentMode;
  trigger: AiEnrichmentTrigger;
  explicit: boolean;
  interactive: boolean;
  ci: boolean;
  providerOrigin?: string;
  model: string;
  status: AiEnrichmentStatus;
  inputSha256: string;
  fingerprints: {
    demandProfileSha256: string | null;
    selectedCatalogSha256: string | null;
    configSha256: string;
  };
  summary?: string;
  recommendations?: string[];
  warnings?: string[];
  reason?: string;
  error?: string;
  reusedFromGeneratedAt?: string;
}
