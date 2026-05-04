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
} from "./core.js";
import type { DemandProfile, DemandSignalSet } from "./discovery.js";

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
 * Describes recommendation host policy data exchanged by the lifecycle pipeline.
 */
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
  redundancyPenalty: number;
  budgetPenalty: number;
  total: number;
}

/**
 * Describes recommendation entry data exchanged by the lifecycle pipeline.
 */
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

/**
 * Describes recommendation host summary data exchanged by the lifecycle pipeline.
 */
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

/**
 * Describes recommendation suggested bundle data exchanged by the lifecycle pipeline.
 */
export interface RecommendationSuggestedBundle {
  host: HostTarget;
  bundleId: string;
  assetIds: string[];
  estimatedPromptWeight: number;
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
  topByHost: Record<string, RecommendationEntry[]>;
  hostSummaries: Record<string, RecommendationHostSummary>;
  suggestedBundles: RecommendationSuggestedBundle[];
}

/**
 * Describes recommendation evaluation expectation data exchanged by the lifecycle pipeline.
 */
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
 * Describes recommendation evaluation result data exchanged by the lifecycle pipeline.
 */
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
