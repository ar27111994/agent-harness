import type {
  AssetKind,
  AuthorityTier,
  HostTarget,
  SourceKind,
} from "./core.js";

export interface SourcePublisher {
  name: string;
  verified?: boolean;
  owner?: string;
}

export interface SourceRules {
  officialPreferred: boolean;
  allowMirror: boolean;
  allowInstall: boolean;
}

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

export interface SourceRegistry {
  $schema?: string;
  schemaVersion: number;
  sources: SourceDefinition[];
}

export interface SelectionPolicies {
  officialBeatsPopularity: boolean;
  starsAreTieBreakerOnly: boolean;
  preferNativeOverAdaptable: boolean;
  preferLowerRiskWhenEquivalent: boolean;
  preferLowerContextCostWhenEquivalent: boolean;
  communityDefaultPolicy: "catalog-only-unless-promoted";
}

export interface DuplicateGroup {
  id: string;
  capability: string;
  preferredAuthorityTier: AuthorityTier | string;
  selectionReason: string;
}

export interface SelectionRegistry {
  $schema?: string;
  schemaVersion: number;
  selectionPolicies: SelectionPolicies;
  rankingOrder: string[];
  duplicateGroups: DuplicateGroup[];
}

export interface DemandSignalSet {
  languages: string[];
  packageManagers: string[];
  frameworks: string[];
  concerns: string[];
  tooling: string[];
}

export interface DemandEvidence {
  path: string;
  fileName: string;
  matchedSignals: DemandSignalSet;
}

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
