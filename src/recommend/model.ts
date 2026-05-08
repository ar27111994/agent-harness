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
 * Describes dynamic score data exchanged by the lifecycle pipeline.
 */
export interface DynamicScore {
  total: number;
  coverage: number;
  diversity: number;
  redundancyPenalty: number;
  budgetPenalty: number;
}
