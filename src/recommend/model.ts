import type {
  AssetCatalogEntry,
  RecommendationScoreBreakdown,
  RecommendationSignalMatch,
  RecommendationSignalType,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";

export interface DemandTermContext {
  key: string;
  canonicalTerm: string;
  signalType: RecommendationSignalType;
  evidenceCount: number;
  matchTerms: Set<string>;
}

export interface DemandContext {
  terms: DemandTermContext[];
  hasSignals: boolean;
  activeDomainGroups: Set<string>;
}

export interface CandidateRecommendation {
  entry: AssetCatalogEntry;
  host: RecommendationHost;
  sourceFamily: string;
  coverageTags: string[];
  taskModes: string[];
  matchedSignals: RecommendationSignalMatch[];
  duplicateGroup?: string;
  reasons: string[];
  breakdown: RecommendationScoreBreakdown;
}

export interface DynamicScore {
  total: number;
  coverage: number;
  diversity: number;
  redundancyPenalty: number;
  budgetPenalty: number;
}
