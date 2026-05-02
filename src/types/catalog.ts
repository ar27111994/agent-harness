import type {
  AssetKind,
  AuthorityTier,
  CompatibilityMode,
  HostTarget,
  SourceKind,
} from "./core.js";

export interface AssetSourceMetadata {
  sourceId: string;
  authorityTier: AuthorityTier;
  sourceKind: SourceKind;
  sourcePriority: number;
  originUrl: string;
  publisher: string;
  publisherVerified: boolean;
}

export interface AssetTrust {
  score: number;
  signals: string[];
}

export type AssetPrerequisiteKind = "env" | "host-login" | "oauth" | "manual";

export interface AssetPrerequisite {
  id: string;
  kind: AssetPrerequisiteKind;
  required: boolean;
  description: string;
  provider?: string;
  envVars?: string[];
  setupUrl?: string;
  host?: HostTarget;
}

export interface AssetInstallMetadata {
  method: string;
  nativeHosts?: HostTarget[];
  adaptableHosts?: HostTarget[];
  relativePath?: string;
  manifestEntry?: string;
  dependencies?: string[];
  prerequisites?: AssetPrerequisite[];
}

export interface AssetEvidence {
  manifestFound: boolean;
  readmeFound: boolean;
  examplesFound: boolean;
  docsLinked: boolean;
  frontmatterFound?: boolean;
  lineCount?: number;
  dependencies?: string[];
  filePath?: string;
  rootPath?: string;
}

export interface AssetMaintenance {
  lastUpdated: string;
  stars: number;
  releaseCadence: string;
}

export interface AssetRisk {
  level: "low" | "medium" | "high";
  hasHooks: boolean;
  hasExecScripts: boolean;
  requiresNetwork: boolean;
}

export interface AssetContextCost {
  sizeClass: "tiny" | "small" | "medium" | "large";
  estimatedPromptWeight: number;
}

export interface AssetFit {
  portfolioFit: number;
  hostFit: number;
}

export interface AssetDedupe {
  duplicateGroup?: string;
  candidateRankHint: string;
}

export interface AssetStatus {
  cataloged: boolean;
  mirrorEligible: boolean;
  installEligible: boolean;
  activationEligible: boolean;
}

export interface AssetCatalogEntry {
  id: string;
  displayName: string;
  assetKind: AssetKind;
  hosts: HostTarget[];
  compatibilityMode: CompatibilityMode;
  source: AssetSourceMetadata;
  trust: AssetTrust;
  capabilities: string[];
  install: AssetInstallMetadata;
  evidence: AssetEvidence;
  maintenance: AssetMaintenance;
  risk: AssetRisk;
  contextCost: AssetContextCost;
  fit: AssetFit;
  dedupe: AssetDedupe;
  status: AssetStatus;
}
