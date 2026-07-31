import type {
  AssetCatalogEntry,
  DemandEvidenceStrength,
  RecommendationBasis,
  RecommendationScoreBreakdown,
  RecommendationSignalMatch,
  RecommendationSignalType,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";

/**
 * Describes demand term context data exchanged by the lifecycle pipeline.
 */
export interface DemandTermContext {
  key: string;
  canonicalTerm: string;
  signalType: RecommendationSignalType;
  evidenceCount: number;
  evidenceStrengthCounts: Record<DemandEvidenceStrength, number>;
  matchTerms: Set<string>;
}

/**
 * Describes demand context data exchanged by the lifecycle pipeline.
 */
export interface DemandContext {
  terms: DemandTermContext[];
  hasSignals: boolean;
  activeDomainGroups: Set<string>;
  packageManifestEntries: Set<string>;
  demandKeywords: Set<string>;
  /**
   * Normalised set of package-manager family names detected in the workspace
   * demand profile (e.g. "npm", "pip", "composer"). Used for ecosystem-affinity
   * penalty computation. Empty when no demand profile is available.
   */
  packageManagers: Set<string>;
}

/**
 * Describes candidate recommendation data exchanged by the lifecycle pipeline.
 */
export interface CandidateRecommendation {
  entry: AssetCatalogEntry;
  host: RecommendationHost;
  sourceFamily: string;
  availableLocally: boolean;
  recommendationBasis: RecommendationBasis;
  coverageTags: string[];
  taskModes: string[];
  matchedSignals: RecommendationSignalMatch[];
  duplicateGroup?: string;
  reasons: string[];
  breakdown: RecommendationScoreBreakdown;
}

/**
 * Describes host-independent recommendation analysis shared across all host
 * ranking passes for one report build.
 */
export interface CandidateRecommendationBase {
  entry: AssetCatalogEntry;
  sourceFamily: string;
  availableLocally: boolean;
  recommendationBasis: RecommendationBasis;
  coverageTags: string[];
  taskModes: string[];
  matchedSignals: RecommendationSignalMatch[];
  duplicateGroup?: string;
  reasons: string[];
  searchTerms: Set<string>;
  breakdown: RecommendationScoreBreakdown;
}

/**
 * Describes precomputed policy search sets shared across all candidates for one
 * recommendation host run, avoiding per-candidate policy-map rebuilds.
 */
export interface PolicySearchContext {
  genericToolingTerms: Set<string>;
  wrapperLikeTerms: Set<string>;
  concernTermSets: Map<string, Set<string>>;
  taskModeTermSets: Map<string, Set<string>>;
  domainGroupTermSets: Map<string, Set<string>>;
}

/**
 * Describes one candidate's dynamic score after host-selection adjustments.
 */
export interface DynamicScore {
  total: number;
  coverage: number;
  diversity: number;
  assetKindDiversityPenalty: number;
  redundancyPenalty: number;
  budgetPenalty: number;
}
