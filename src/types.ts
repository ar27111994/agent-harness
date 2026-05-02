export type AuthorityTier =
  | "trusted-local"
  | "official-first-party"
  | "official-marketplace"
  | "official-compatible"
  | "trusted-community"
  | "unverified-community";

export type SourceKind =
  | "repo"
  | "docs"
  | "marketplace"
  | "registry"
  | "package-registry"
  | "local-manifest"
  | "local-directory";

export type AssetKind =
  | "skill"
  | "plugin"
  | "mcp-server"
  | "agent"
  | "instruction"
  | "workflow"
  | "hook"
  | "extension"
  | "prompt-pack"
  | "reference-pack";

export type HostTarget =
  | "copilot-vscode"
  | "opencode"
  | "shared"
  | "cursor"
  | "zed"
  | "claude-code"
  | "pi";

export type CompatibilityMode =
  | "native"
  | "adaptable"
  | "partial"
  | "reference-only"
  | "incompatible";

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

export interface AssetInstallMetadata {
  method: string;
  nativeHosts?: HostTarget[];
  adaptableHosts?: HostTarget[];
  relativePath?: string;
  manifestEntry?: string;
  dependencies?: string[];
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

export interface BundleTemplate {
  id: string;
  host: HostTarget;
  description: string;
  assetKinds: AssetKind[];
  defaultPromotion: string;
}

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

export interface SelectionDuplicateDecision {
  duplicateGroup: string;
  selectedAssetId: string;
  rejectedAssetIds: string[];
  selectionReason: string;
}

export interface SelectionReport {
  schemaVersion: number;
  generatedAt: string;
  inputCount: number;
  selectedCount: number;
  rejectedCount: number;
  duplicateDecisions: SelectionDuplicateDecision[];
}

export interface BundleLockAsset {
  assetId: string;
  mirrorId: string;
  projectionType: string;
  activationEligible: boolean;
  notes?: string;
}

export interface BundleLock {
  schemaVersion: number;
  bundleId: string;
  generatedAt: string;
  host: HostTarget;
  assets: BundleLockAsset[];
}

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

export interface MirrorAcquireState {
  schemaVersion: number;
  updatedAt: string;
  batchSize: number;
  totalEligibleCount: number;
  mirroredCount: number;
  remainingCount: number;
  lastBatchAssetIds: string[];
}

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

export interface ActivationManifest {
  schemaVersion: number;
  host: HostTarget;
  generatedAt: string;
  generationId?: string;
  activeBundles: string[];
  activeAssets: string[];
  runtimeRoot: string;
  notes: string[];
}

export interface CopilotWorkspaceOverlayManifest {
  schemaVersion: 1;
  host: "copilot-vscode";
  generatedAt: string;
  workspaceRoot: string;
  selectedBundleIds: string[];
  selectedAssetIds: string[];
  activationBudget: number;
  mode: string;
  sessionIntent?: string;
  concernBuckets?: Record<string, string[]>;
  taskModeBuckets?: Record<string, string[]>;
}

export type RecommendationSignalType = keyof DemandSignalSet;

export interface RecommendationScoringPolicy {
  demandMatchCap: number;
  portfolioFitMultiplier: number;
  trustDivisor: number;
  sourcePriorityDivisor: number;
  authorityWeights: Record<AuthorityTier, number>;
  compatibilityWeights: Record<CompatibilityMode, number>;
  costPenalties: Record<AssetContextCost["sizeClass"], number>;
  demandSignalWeights: Record<RecommendationSignalType, number>;
  riskLevelPenalties: Record<AssetRisk["level"], number>;
  riskFlagPenalties: {
    hasHooks: number;
    hasExecScripts: number;
    requiresNetwork: number;
  };
  freshness: {
    recentDays: number;
    recentBoost: number;
    staleDays: number;
    stalePenalty: number;
    unknownPenalty: number;
  };
  genericCapabilityPenalty: number;
  lowFitPenaltyThreshold: number;
  lowFitPenalty: number;
  weakDemandPenalty: number;
  outOfDomainGroupPenalty: number;
  coverageGainWeight: number;
  sourceDiversityBonus: number;
  overlapPenalty: number;
  demandTermMultipliers: Record<string, number>;
}

export interface RecommendationTargetAssetKindPreference {
  assetKind: AssetKind;
  minimum: number;
  weight: number;
}

export interface RecommendationTargetConcernPreference {
  concern: string;
  minimum: number;
  weight: number;
}

export interface RecommendationPolicyPresets {
  targetAssetKinds?: Record<string, RecommendationTargetAssetKindPreference[]>;
  targetConcerns?: Record<string, RecommendationTargetConcernPreference[]>;
}

export interface RecommendationPolicyPresetRefs {
  targetAssetKinds?: string[];
  targetConcerns?: string[];
}

export interface RecommendationHostPolicy {
  recommendationLimit: number;
  activationBudget: number;
  suggestedBundleId: string;
  fallbackSkillCount?: number;
  maxPerSourceFamily: number;
  maxPerDuplicateGroup: number;
  maxPerAssetKind: Partial<Record<AssetKind, number>>;
  targetAssetKinds: RecommendationTargetAssetKindPreference[];
  targetConcerns: RecommendationTargetConcernPreference[];
  suppressedAssetIdPatterns: string[];
  suppressedCapabilityTerms: string[];
  deprioritizedPenalty?: number;
  deprioritizedAssetIdPatterns?: string[];
  deprioritizedCapabilityTerms?: string[];
  sourceSaturationFreeCount?: number;
  sourceSaturationPenaltyStep?: number;
}

export interface RecommendationPolicyBase {
  schemaVersion: number;
  scoring: RecommendationScoringPolicy;
  hostDefaults?: Partial<RecommendationHostPolicy>;
  presets?: RecommendationPolicyPresets;
  concernKeywordMap: Record<string, string[]>;
  taskModeKeywordMap: Record<string, string[]>;
  domainKeywordGroups: Record<string, string[]>;
  synonyms: Record<string, string[]>;
}

export interface RecommendationHostPolicyOverride {
  schemaVersion: number;
  host: HostTarget;
  presetRefs?: RecommendationPolicyPresetRefs;
  policy: Partial<RecommendationHostPolicy>;
}

export interface RecommendationPolicy {
  schemaVersion: number;
  scoring: RecommendationScoringPolicy;
  hosts: Record<HostTarget, RecommendationHostPolicy>;
  concernKeywordMap: Record<string, string[]>;
  taskModeKeywordMap: Record<string, string[]>;
  domainKeywordGroups: Record<string, string[]>;
  synonyms: Record<string, string[]>;
}

export interface RecommendationSignalMatch {
  term: string;
  signalType: RecommendationSignalType;
  weight: number;
  evidenceCount: number;
}

export interface RecommendationScoreBreakdown {
  authority: number;
  compatibility: number;
  portfolioFit: number;
  trust: number;
  sourcePriority: number;
  demand: number;
  hostPreference: number;
  coverage: number;
  diversity: number;
  freshness: number;
  costPenalty: number;
  riskPenalty: number;
  negativePenalty: number;
  redundancyPenalty: number;
  budgetPenalty: number;
  total: number;
}

export interface RecommendationEntry {
  assetId: string;
  host: HostTarget;
  rank: number;
  score: number;
  reasons: string[];
  assetKind?: AssetKind;
  sourceId: string;
  sourceFamily: string;
  contextSizeClass: AssetContextCost["sizeClass"];
  estimatedPromptWeight: number;
  duplicateGroup?: string;
  selectionStage: "top-by-host";
  coverageTags: string[];
  taskModes: string[];
  matchedSignals: RecommendationSignalMatch[];
  scoreBreakdown: RecommendationScoreBreakdown;
}

export interface RecommendationHostSummary {
  host: HostTarget;
  recommendationLimit: number;
  activationBudget: number;
  selectedCount: number;
  totalEstimatedPromptWeight: number;
  selectedAssetIds: string[];
  byAssetKind: Record<string, number>;
  bySourceFamily: Record<string, number>;
  byConcern: Record<string, number>;
  concernBuckets: Record<string, string[]>;
  taskModeBuckets: Record<string, string[]>;
}

export interface RecommendationSuggestedBundle {
  host: HostTarget;
  bundleId: string;
  assetIds: string[];
  estimatedPromptWeight: number;
  concernBuckets: Record<string, string[]>;
  taskModeBuckets: Record<string, string[]>;
}

export interface RecommendationReport {
  schemaVersion: number;
  generatedAt: string;
  policyVersion: number;
  topByHost: Record<string, RecommendationEntry[]>;
  hostSummaries: Record<string, RecommendationHostSummary>;
  suggestedBundles: RecommendationSuggestedBundle[];
}

export interface RecommendationEvaluationExpectation {
  host: HostTarget;
  requiredAssetIds?: string[];
  requiredAssetKinds?: Array<{
    assetKind: AssetKind;
    minimum: number;
  }>;
  maxPerSourceFamily?: number;
  requiredConcerns?: string[];
  rankedAbove?: Array<{
    higherAssetId: string;
    lowerAssetId: string;
  }>;
}

export interface RecommendationEvaluationFixture {
  schemaVersion: number;
  id: string;
  description: string;
  demandProfile: DemandProfile;
  catalogEntries: AssetCatalogEntry[];
  expectations: RecommendationEvaluationExpectation[];
}

export interface RecommendationEvaluationCheck {
  name: string;
  passed: boolean;
  details: string;
}

export interface RecommendationEvaluationResult {
  schemaVersion: number;
  generatedAt: string;
  fixtures: Array<{
    id: string;
    description: string;
    passed: boolean;
    checks: RecommendationEvaluationCheck[];
  }>;
}

export interface CopilotWorkspaceProfileManifest {
  schemaVersion: number;
  generatedAt: string;
  profileId: string;
  workspaceRoot: string;
  bundleIds: string[];
  selectedAssetIds: string[];
  selectedInstructionIds: string[];
  selectedAgentIds: string[];
  selectedWorkflowIds: string[];
  selectedPluginIds?: string[];
  selectedExtensionIds?: string[];
  selectedHookIds?: string[];
  selectedSkillIds?: string[];
  activationBudget: number;
  sessionIntent?: string;
}

export interface WirePlanManifest {
  schemaVersion: number;
  host:
    | HostTarget
    | "vscode-user"
    | "opencode-project"
    | "cursor"
    | "zed"
    | "claude-code"
    | "pi";
  generatedAt: string;
  workspaceRoot: string;
  runtimeRoot: string;
  linkedPaths?: string[];
  instructionsFiles?: string[];
  agentFiles?: string[];
  skillDirs?: string[];
  pluginDirs?: string[];
  extensionIds?: string[];
  mcpServers?: string[];
  nativeInstallActions?: string[];
  hookFiles?: string[];
  notes: string[];
}

export interface WirePreviewManifest {
  schemaVersion: number;
  host: "vscode" | "opencode";
  mode: "preview" | "apply" | "reset";
  generatedAt: string;
  workspaceRoot: string;
  targetPaths: string[];
  notes: string[];
}
