import type {
  AssetCatalogEntry,
  AssetContextCost,
  AssetRisk,
} from "./catalog.js";
import type {
  AssetKind,
  AuthorityTier,
  CompatibilityMode,
  HostTarget,
  SessionIntent,
} from "./core.js";
import type {
  DemandEvidenceStrength,
  DemandProfile,
  DemandSignalSet,
} from "./discovery.js";

/**
 * Defines the supported recommendation signal type values.
 */
export type RecommendationSignalType = keyof DemandSignalSet;

/**
 * Describes recommendation scoring policy data exchanged by the lifecycle pipeline.
 */
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
  ecosystemMismatchPenalty: number;
  coverageGainWeight: number;
  sourceDiversityBonus: number;
  overlapPenalty: number;
  demandTermMultipliers: Record<string, number>;
}

/**
 * Describes recommendation target asset kind preference data exchanged by the lifecycle pipeline.
 */
export interface RecommendationTargetAssetKindPreference {
  assetKind: AssetKind;
  minimum: number;
  weight: number;
}

/**
 * Describes recommendation target concern preference data exchanged by the lifecycle pipeline.
 */
export interface RecommendationTargetConcernPreference {
  concern: string;
  minimum: number;
  weight: number;
}

/**
 * Describes recommendation policy presets data exchanged by the lifecycle pipeline.
 */
export interface RecommendationPolicyPresets {
  targetAssetKinds?: Record<string, RecommendationTargetAssetKindPreference[]>;
  targetConcerns?: Record<string, RecommendationTargetConcernPreference[]>;
}

/**
 * Describes recommendation policy preset refs data exchanged by the lifecycle pipeline.
 */
export interface RecommendationPolicyPresetRefs {
  targetAssetKinds?: string[];
  targetConcerns?: string[];
}

/**
 * Describes recommendation-limit override mode data exchanged by the lifecycle pipeline.
 */
export type RecommendationLimitOverrideMode = "preserve" | "scale";

/**
 * Describes recommendation host policy data exchanged by the lifecycle pipeline.
 */
export interface RecommendationHostPolicy {
  recommendationLimit: number;
  activationBudget: number;
  suggestedBundleId: string;
  recommendationLimitOverrideMode?: RecommendationLimitOverrideMode;
  recommendationLimitScaleFactor?: number;
  recommendationLimitScaledFields?: string[];
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

/**
 * Describes recommendation policy base data exchanged by the lifecycle pipeline.
 */
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

/**
 * Describes user-owned recommendation policy base overrides.
 */
export interface RecommendationPolicyBaseOverride {
  schemaVersion: number;
  scoring?: RecommendationScoringPolicy;
  hostDefaults?: Partial<RecommendationHostPolicy>;
  presets?: RecommendationPolicyPresets;
  concernKeywordMap?: Record<string, string[]>;
  taskModeKeywordMap?: Record<string, string[]>;
  domainKeywordGroups?: Record<string, string[]>;
  synonyms?: Record<string, string[]>;
}

/**
 * Describes recommendation host policy override data exchanged by the lifecycle pipeline.
 */
export interface RecommendationHostPolicyOverride {
  schemaVersion: number;
  host: HostTarget;
  presetRefs?: RecommendationPolicyPresetRefs;
  policy: Partial<RecommendationHostPolicy>;
}

/**
 * Describes recommendation policy data exchanged by the lifecycle pipeline.
 */
export interface RecommendationPolicy {
  schemaVersion: number;
  scoring: RecommendationScoringPolicy;
  hosts: Record<HostTarget, RecommendationHostPolicy>;
  concernKeywordMap: Record<string, string[]>;
  taskModeKeywordMap: Record<string, string[]>;
  domainKeywordGroups: Record<string, string[]>;
  synonyms: Record<string, string[]>;
}

/**
 * Describes recommendation signal match data exchanged by the lifecycle pipeline.
 */
export interface RecommendationSignalMatch {
  term: string;
  signalType: RecommendationSignalType;
  weight: number;
  evidenceCount: number;
  weightedEvidenceCount?: number;
  evidenceStrengthCounts?: Record<DemandEvidenceStrength, number>;
}

/**
 * Describes recommendation score breakdown data exchanged by the lifecycle pipeline.
 */
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
  ecosystemMismatchPenalty: number;
  redundancyPenalty: number;
  budgetPenalty: number;
  total: number;
}

/**
 * Defines whether a recommendation is present because it fits the workspace or
 * because it is already available locally for convenience.
 */
export type RecommendationBasis = "workspace-fit" | "local-availability";

/**
 * Describes recommendation entry data exchanged by the lifecycle pipeline.
 */
export interface RecommendationEntry {
  assetId: string;
  host: HostTarget;
  /**
   * Per-host rank (1-based position within the host's sorted candidate list).
   * For the global ordering of the flat `RecommendationReport.recommendations`
   * array, use `globalRank` instead.
   */
  rank: number;
  /**
   * Global rank (1-based position within the deduplicated, globally-sorted
   * `RecommendationReport.recommendations` list). Only present on entries in
   * that flat list; absent on `topByHost` entries where `rank` is authoritative.
   */
  globalRank?: number;
  score: number;
  reasons: string[];
  assetKind?: AssetKind;
  classificationConfidence?: number;
  classificationConfidenceLevel?: "strong" | "medium" | "weak";
  sourceId: string;
  sourceFamily: string;
  availableLocally: boolean;
  recommendationBasis: RecommendationBasis;
  contextSizeClass: AssetContextCost["sizeClass"];
  estimatedPromptWeight: number;
  duplicateGroup?: string;
  selectionStage: "top-by-host";
  coverageTags: string[];
  taskModes: string[];
  matchedSignals: RecommendationSignalMatch[];
  scoreBreakdown: RecommendationScoreBreakdown;
}

/**
 * Defines where one effective recommendation policy scalar came from.
 */
export type RecommendationPolicyValueSource = "policy" | "env";

/**
 * Describes recommendation host summary data exchanged by the lifecycle pipeline.
 */
export interface RecommendationHostSummary {
  host: HostTarget;
  recommendationLimit: number;
  recommendationLimitSource: RecommendationPolicyValueSource;
  recommendationLimitEnvVar?: string;
  recommendationLimitOverrideMode: RecommendationLimitOverrideMode;
  recommendationLimitOverrideModeSource: RecommendationPolicyValueSource;
  recommendationLimitOverrideModeEnvVar?: string;
  recommendationLimitScaleFactor?: number;
  recommendationLimitScaledFields?: string[];
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

/**
 * Describes one ranked recommendation omitted from a suggested bundle by budget.
 */
export interface RecommendationSuggestedBundlePrunedAsset {
  assetId: string;
  estimatedPromptWeight: number;
  remainingBudget: number;
  reason: string;
}

/**
 * Describes recommendation suggested bundle data exchanged by the lifecycle pipeline.
 */
export interface RecommendationSuggestedBundle {
  host: HostTarget;
  bundleId: string;
  assetIds: string[];
  estimatedPromptWeight: number;
  activationBudget?: number;
  budgetPrunedAssetIds?: string[];
  budgetPrunedAssets?: RecommendationSuggestedBundlePrunedAsset[];
  concernBuckets: Record<string, string[]>;
  taskModeBuckets: Record<string, string[]>;
}

/**
 * Describes recommendation report data exchanged by the lifecycle pipeline.
 */
export interface RecommendationReport {
  schemaVersion: number;
  generatedAt: string;
  policyVersion: number;
  /** Primary intent; always present for backward compatibility. */
  sessionIntent: SessionIntent;
  /** Full intent list when more than one intent was requested. */
  sessionIntents?: SessionIntent[];
  /**
   * Deduplicated, globally-ranked flat list of all recommendations across
   * every host target, ordered by descending score. Each asset appears at
   * most once (the highest-scoring entry across hosts is kept when the same
   * asset surfaces for multiple hosts).
   */
  recommendations: RecommendationEntry[];
  topByHost: Record<string, RecommendationEntry[]>;
  hostSummaries: Record<string, RecommendationHostSummary>;
  suggestedBundles: RecommendationSuggestedBundle[];
}

/**
 * Describes one shortlisted candidate presented to the AI review stage.
 */
export interface RecommendationAiReviewCandidate {
  assetId: string;
  host: HostTarget;
  rank: number;
  score: number;
  assetKind?: AssetKind;
  sourceFamily: string;
  availableLocally: boolean;
  recommendationBasis: RecommendationBasis;
  duplicateGroup?: string;
  coverageTags: string[];
  taskModes: string[];
  matchedSignals: RecommendationSignalMatch[];
  reasons: string[];
  scoreBreakdown: RecommendationScoreBreakdown;
}

/**
 * Describes one host shortlist presented to the AI review stage.
 */
export interface RecommendationAiReviewHostInput {
  host: HostTarget;
  candidates: RecommendationAiReviewCandidate[];
}

/**
 * Describes bounded AI review input data exchanged by the lifecycle pipeline.
 */
export interface RecommendationAiReviewInput {
  schemaVersion: number;
  generatedAt: string;
  policyVersion: number;
  reviewLimit: number;
  demandSignals: DemandSignalSet | null;
  reviewedHosts: HostTarget[];
  hosts: RecommendationAiReviewHostInput[];
}

/**
 * Defines the supported AI review confidence values.
 */
export type RecommendationAiReviewConfidence = "low" | "medium" | "high";

/**
 * Describes one AI review note for a shortlisted asset.
 */
export interface RecommendationAiReviewNote {
  assetId: string;
  reason: string;
  confidence: RecommendationAiReviewConfidence;
}

/**
 * Describes one bounded rerank adjustment proposed by the AI review stage.
 */
export interface RecommendationAiReviewRerank {
  assetId: string;
  delta: number;
  reason: string;
  confidence: RecommendationAiReviewConfidence;
}

/**
 * Describes one host's AI review decisions.
 */
export interface RecommendationAiReviewHostResult {
  host: HostTarget;
  acceptedAssetIds: string[];
  questionable: RecommendationAiReviewNote[];
  suppressedAssetIds: string[];
  rerank: RecommendationAiReviewRerank[];
}

/**
 * Describes persisted AI review artifact data exchanged by the lifecycle pipeline.
 */
export interface RecommendationAiReviewArtifact {
  schemaVersion: number;
  generatedAt: string;
  enabled: boolean;
  status: "disabled" | "completed" | "failed";
  provider?: string;
  model?: string;
  reviewedHosts: HostTarget[];
  hostReviews: RecommendationAiReviewHostResult[];
  warnings?: string[];
  error?: string;
}

/**
 * Describes recommendation evaluation expectation data exchanged by the lifecycle pipeline.
 */
export interface RecommendationEvaluationExpectation {
  host: HostTarget;
  requiredAssetIds?: string[];
  forbiddenAssetIds?: string[];
  forbiddenTopAssetIds?: string[];
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

/**
 * Describes recommendation evaluation fixture data exchanged by the lifecycle pipeline.
 */
export interface RecommendationEvaluationFixture {
  schemaVersion: number;
  id: string;
  description: string;
  demandProfile: DemandProfile;
  catalogEntries: AssetCatalogEntry[];
  expectations: RecommendationEvaluationExpectation[];
}

/**
 * Describes recommendation evaluation check data exchanged by the lifecycle pipeline.
 */
export interface RecommendationEvaluationCheck {
  name: string;
  passed: boolean;
  details: string;
}

/**
 * Describes top-recommendation confidence classes surfaced by fixture evaluation.
 */
export type RecommendationEvaluationTopConfidence =
  "medium-or-strong" | "weak-only" | "none";

/**
 * Describes the top recommendation observed for one evaluated host.
 */
export interface RecommendationEvaluationHostSummary {
  host: HostTarget;
  topAssetId: string | null;
  topReasons: string[];
  topRecommendationBasis: RecommendationBasis | null;
  topAvailableLocally: boolean;
  topConfidence: RecommendationEvaluationTopConfidence;
  topCoverageTags: string[];
}

/**
 * Describes one evaluated fixture result.
 */
export interface RecommendationEvaluationFixtureResult {
  id: string;
  description: string;
  passed: boolean;
  checks: RecommendationEvaluationCheck[];
  hostSummaries: RecommendationEvaluationHostSummary[];
}

/**
 * Describes aggregate quality metrics for the recommendation evaluation suite.
 */
export interface RecommendationEvaluationSummary {
  fixtureCount: number;
  passedFixtureCount: number;
  failedFixtureCount: number;
  evaluatedHostCount: number;
  topReasonCounts: {
    exactStack: number;
    ecosystem: number;
    genericConcern: number;
    none: number;
  };
  broadFallbackTopCount: number;
  /** Host IDs with broad-fallback top recommendations, for diagnostic triage. */
  broadFallbackHosts: string[];
  localAvailabilityTopCount: number;
  topConfidenceCounts: {
    mediumOrStrong: number;
    weakOnly: number;
    none: number;
  };
}

/**
 * Describes recommendation evaluation result data exchanged by the lifecycle pipeline.
 */
export interface RecommendationEvaluationResult {
  schemaVersion: number;
  generatedAt: string;
  summary: RecommendationEvaluationSummary;
  fixtures: RecommendationEvaluationFixtureResult[];
}
