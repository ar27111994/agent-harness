import type {
  AssetKind,
  AuthorityTier,
  CompatibilityMode,
  HostTarget,
  SourceKind,
} from "./core.js";

/**
 * Defines the supported host-native payload target values.
 */
export type HostNativeConfigTarget =
  | "opencode"
  | "cursor"
  | "zed"
  | "claude-code"
  | "pi";

/**
 * Describes host-native text file payloads exchanged by the lifecycle pipeline.
 */
export interface AssetHostNativeTextFilePayload {
  path: string;
  format: "text";
  content: string;
}

/**
 * Describes host-native JSON file payloads exchanged by the lifecycle pipeline.
 */
export interface AssetHostNativeJsonFilePayload {
  path: string;
  format: "json";
  content: Record<string, unknown>;
  merge?: boolean;
}

/**
 * Describes a host-native file payload exchanged by the lifecycle pipeline.
 */
export type AssetHostNativeFilePayload =
  | AssetHostNativeTextFilePayload
  | AssetHostNativeJsonFilePayload;

/**
 * Describes one host's structured native-config payloads.
 */
export interface AssetHostNativeConfig {
  files: AssetHostNativeFilePayload[];
}

/**
 * Describes host-native config payloads for supported adapters.
 */
export interface AssetHostNativeConfigMap {
  opencode?: AssetHostNativeConfig;
  cursor?: AssetHostNativeConfig;
  zed?: AssetHostNativeConfig;
  "claude-code"?: AssetHostNativeConfig;
  pi?: AssetHostNativeConfig;
}

/**
 * Describes asset source metadata data exchanged by the lifecycle pipeline.
 */
export interface AssetSourceMetadata {
  sourceId: string;
  authorityTier: AuthorityTier;
  sourceKind: SourceKind;
  sourcePriority: number;
  originUrl: string;
  publisher: string;
  publisherVerified: boolean;
}

/**
 * Describes asset trust data exchanged by the lifecycle pipeline.
 */
export interface AssetTrust {
  score: number;
  signals: string[];
}

/**
 * Defines the supported asset prerequisite kind values.
 */
export type AssetPrerequisiteKind = "env" | "host-login" | "oauth" | "manual";

/**
 * Describes asset prerequisite data exchanged by the lifecycle pipeline.
 */
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

/**
 * Describes asset install metadata data exchanged by the lifecycle pipeline.
 */
export interface AssetInstallMetadata {
  method: string;
  nativeHosts?: HostTarget[];
  adaptableHosts?: HostTarget[];
  relativePath?: string;
  manifestEntry?: string;
  dependencies?: string[];
  prerequisites?: AssetPrerequisite[];
}

/**
 * Describes asset evidence data exchanged by the lifecycle pipeline.
 */
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

/**
 * Describes asset maintenance data exchanged by the lifecycle pipeline.
 */
export interface AssetMaintenance {
  lastUpdated: string;
  stars: number;
  releaseCadence: string;
}

/**
 * Describes asset risk data exchanged by the lifecycle pipeline.
 */
export interface AssetRisk {
  level: "low" | "medium" | "high";
  hasHooks: boolean;
  hasExecScripts: boolean;
  requiresNetwork: boolean;
}

/**
 * Describes asset context cost data exchanged by the lifecycle pipeline.
 */
export interface AssetContextCost {
  sizeClass: "tiny" | "small" | "medium" | "large";
  estimatedPromptWeight: number;
}

/**
 * Describes asset fit data exchanged by the lifecycle pipeline.
 */
export interface AssetFit {
  portfolioFit: number;
  hostFit: number;
}

/**
 * Describes asset dedupe data exchanged by the lifecycle pipeline.
 */
export interface AssetDedupe {
  duplicateGroup?: string;
  candidateRankHint: string;
}

/**
 * Describes asset status data exchanged by the lifecycle pipeline.
 */
export interface AssetStatus {
  cataloged: boolean;
  mirrorEligible: boolean;
  installEligible: boolean;
  activationEligible: boolean;
}

/**
 * Describes asset catalog entry data exchanged by the lifecycle pipeline.
 */
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
  hostNativeConfig?: AssetHostNativeConfigMap;
}
