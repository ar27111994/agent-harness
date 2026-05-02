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
