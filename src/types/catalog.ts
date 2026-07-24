import type {
  AssetKind,
  AuthorityTier,
  CompatibilityMode,
  HostTarget,
  SourceKind,
} from "./core.js";
import type { CompatibleHost } from "../host-adapters/compatibility-matrix.js";

/**
 * Defines the supported host-native payload target values.
 */
export type HostNativeConfigTarget =
  | "opencode"
  | "cursor"
  | "zed"
  | "claude-code"
  | "pi"
  | "codex";

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
  codex?: AssetHostNativeConfig;
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
  /**
   * How this entry was discovered.
   * - `"manifest"` — declared in a workspace manifest (default, implicit).
   * - `"registry-adjacent-search"` — surfaced via registry search or adjacent-tooling matrix;
   *   not yet declared in any manifest.
   */
  discoveryMethod?: "manifest" | "registry-adjacent-search";
  /**
   * True when this entry was suggested by the adjacent-tooling matrix rather
   * than directly declared in a workspace manifest or harvested from a source.
   * Set by the package-registry harvester for registry-adjacent discoveries.
   */
  isAdjacentSuggestion?: boolean;
  classification?: {
    assetKind: AssetKind;
    confidence: number;
    level: "strong" | "medium" | "weak";
    evidence: Array<{
      source: string;
      strength: "strong" | "medium" | "weak";
      detail: string;
    }>;
  };
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
  /**
   * Human-readable fit level derived from semantic similarity score.
   * Populated when semantic scoring is enabled; `undefined` when using
   * keyword-overlap fallback mode.
   *
   * - `"strong"` — cosine similarity ≥ 0.75 (high confidence match)
   * - `"moderate"` — cosine similarity ≥ 0.55 (likely relevant)
   * - `"weak"` — cosine similarity ≥ 0.35 (marginally relevant, kept)
   * - `"none"` — similarity below threshold (filtered out)
   */
  fitLevel?: "strong" | "moderate" | "weak" | "none";
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
 * Describes additive query-oriented metadata for future read-only retrieval.
 */
export interface AssetQueryMetadata {
  symbolicHandle: string;
  retrievalFacets: string[];
  chunkingHints: {
    preferredStrategy: "document" | "section" | "file";
    maxPromptWeight: number;
  };
  citation: {
    provenance: string;
    sourceUrl: string;
    sourceId: string;
  };
  safetyFlags: string[];
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
  /**
   * Cross-host compatibility entries beyond the primary `hosts` list.
   * Assets may be auto-populated (e.g. mcp-server → all MCP-capable hosts)
   * or explicitly set via manifest metadata.
   * When present, these hosts are also considered during catalog selection
   * and recommendation, and the wire step emits host-specific instructions
   * when `installDiffers: true`.
   */
  compatibleHosts?: CompatibleHost[];
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
  queryMetadata?: AssetQueryMetadata;
  hostNativeConfig?: AssetHostNativeConfigMap;
  /**
   * Natural-language queries representative of what this asset can do.
   * Used by the ARD semantic scoring path (#327) as the primary embedding
   * text, weighted at 1.2× over other capability signals.
   */
  representativeQueries?: string[];
}
