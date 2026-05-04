import { GENERIC_CAPABILITY_TERMS } from "./constants.js";
import {
  buildCoverageTags,
  buildDuplicateGroup,
  buildSearchTerms,
  buildTaskModes,
  collectMatchedSignals,
  computeOutOfDomainPenalty,
  normalizePhrase,
} from "./signals.js";
import type {
  AssetCatalogEntry,
  RecommendationPolicy,
  RecommendationScoreBreakdown,
  RecommendationSignalMatch,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";
import type { CandidateRecommendation, DemandContext } from "./model.js";

/**
 * Provides compute entry preselection score for the lifecycle pipeline.
 */
export function computeEntryPreselectionScore(
  entry: AssetCatalogEntry,
): number {
  return (
    entry.trust.score +
    entry.source.sourcePriority +
    entry.fit.portfolioFit * 100 +
    entry.fit.hostFit * 60 -
    entry.contextCost.estimatedPromptWeight -
    (entry.risk.level === "high" ? 24 : entry.risk.level === "medium" ? 10 : 0)
  );
}

/**
 * Builds candidate recommendation from the provided inputs.
 */
export function buildCandidateRecommendation(
  entry: AssetCatalogEntry,
  host: RecommendationHost,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): CandidateRecommendation | null {
  const searchTerms = buildSearchTerms(
    [
      entry.id,
      entry.displayName,
      entry.source.sourceId,
      entry.source.publisher,
      ...entry.capabilities,
      entry.install.relativePath ?? "",
      entry.evidence.filePath ?? "",
    ],
    policy,
  );

  if (isSuppressedForHost(entry, host, searchTerms, policy)) {
    return null;
  }

  const matchedSignals = collectMatchedSignals(
    searchTerms,
    demandContext,
    policy,
  );
  const coverageTags = buildCoverageTags(searchTerms, matchedSignals, policy);
  const taskModes = buildTaskModes(
    searchTerms,
    coverageTags,
    matchedSignals,
    policy,
    entry.contextCost,
  );
  const duplicateGroup = buildDuplicateGroup(
    entry.assetKind,
    matchedSignals,
    coverageTags,
    entry.dedupe.duplicateGroup,
  );
  const hostDeprioritizationPenalty = computeHostDeprioritizationPenalty(
    entry,
    host,
    searchTerms,
    policy,
  );

  const breakdown: RecommendationScoreBreakdown = {
    authority: policy.scoring.authorityWeights[entry.source.authorityTier],
    compatibility: policy.scoring.compatibilityWeights[entry.compatibilityMode],
    portfolioFit: Math.round(
      (entry.fit.portfolioFit * 0.7 + entry.fit.hostFit * 0.3) *
        policy.scoring.portfolioFitMultiplier,
    ),
    trust: Math.round(entry.trust.score / policy.scoring.trustDivisor),
    sourcePriority: Math.round(
      entry.source.sourcePriority / policy.scoring.sourcePriorityDivisor,
    ),
    demand: Math.min(
      policy.scoring.demandMatchCap,
      matchedSignals.reduce((total, match) => total + match.weight, 0),
    ),
    hostPreference: computeHostPreference(entry, host, coverageTags, policy),
    coverage: 0,
    diversity: 0,
    freshness: computeFreshnessScore(entry, policy),
    costPenalty: policy.scoring.costPenalties[entry.contextCost.sizeClass],
    riskPenalty:
      policy.scoring.riskLevelPenalties[entry.risk.level] +
      (entry.risk.hasHooks ? policy.scoring.riskFlagPenalties.hasHooks : 0) +
      (entry.risk.hasExecScripts
        ? policy.scoring.riskFlagPenalties.hasExecScripts
        : 0) +
      (entry.risk.requiresNetwork
        ? policy.scoring.riskFlagPenalties.requiresNetwork
        : 0),
    negativePenalty:
      computeNegativePenalty(
        entry,
        searchTerms,
        matchedSignals,
        demandContext,
        policy,
      ) + hostDeprioritizationPenalty,
    redundancyPenalty: 0,
    budgetPenalty: 0,
    total: 0,
  };
  breakdown.total = calculateBreakdownTotal(breakdown);

  return {
    entry,
    host,
    sourceFamily: deriveSourceFamily(entry),
    coverageTags,
    taskModes,
    matchedSignals,
    duplicateGroup,
    reasons: buildBaseReasons(entry, matchedSignals, coverageTags, taskModes),
    breakdown,
  };
}

function computeHostDeprioritizationPenalty(
  entry: AssetCatalogEntry,
  host: RecommendationHost,
  searchTerms: Set<string>,
  policy: RecommendationPolicy,
): number {
  const hostPolicy = policy.hosts[host];
  const penalty = hostPolicy.deprioritizedPenalty ?? 0;
  if (penalty <= 0) {
    return 0;
  }

  const normalizedAssetId = normalizePhrase(entry.id);
  const deprioritizedAssetIdPatterns =
    hostPolicy.deprioritizedAssetIdPatterns ?? [];
  const deprioritizedCapabilityTerms =
    hostPolicy.deprioritizedCapabilityTerms ?? [];

  const matchesAssetIdPattern = deprioritizedAssetIdPatterns.some((pattern) =>
    normalizedAssetId.includes(normalizePhrase(pattern)),
  );
  const matchesCapabilityTerm = deprioritizedCapabilityTerms.some((term) =>
    searchTerms.has(normalizePhrase(term)),
  );

  return matchesAssetIdPattern || matchesCapabilityTerm ? penalty : 0;
}

function computeHostPreference(
  entry: AssetCatalogEntry,
  host: RecommendationHost,
  coverageTags: string[],
  policy: RecommendationPolicy,
): number {
  const hostPolicy = policy.hosts[host];
  let score = 0;

  for (const target of hostPolicy.targetAssetKinds) {
    if (target.assetKind === entry.assetKind) {
      score += target.weight;
    }
  }

  for (const target of hostPolicy.targetConcerns) {
    if (coverageTags.includes(target.concern)) {
      score += Math.max(1, Math.round(target.weight / 2));
    }
  }

  return score;
}

function computeNegativePenalty(
  entry: AssetCatalogEntry,
  searchTerms: Set<string>,
  matchedSignals: RecommendationSignalMatch[],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): number {
  let penalty = 0;

  if (entry.fit.portfolioFit < policy.scoring.lowFitPenaltyThreshold) {
    penalty += policy.scoring.lowFitPenalty;
  }

  if (demandContext.hasSignals && matchedSignals.length === 0) {
    penalty += policy.scoring.weakDemandPenalty;
  }

  penalty += computeOutOfDomainPenalty(searchTerms, demandContext, policy);

  const specificTerms = [...searchTerms].filter(
    (term) => !GENERIC_CAPABILITY_TERMS.has(term) && term.length > 2,
  );
  if (specificTerms.length < 3) {
    penalty += policy.scoring.genericCapabilityPenalty;
  }

  return penalty;
}

function computeFreshnessScore(
  entry: AssetCatalogEntry,
  policy: RecommendationPolicy,
): number {
  const parsedDate = Date.parse(entry.maintenance.lastUpdated);
  if (Number.isNaN(parsedDate)) {
    return -policy.scoring.freshness.unknownPenalty;
  }

  const ageDays = Math.floor((Date.now() - parsedDate) / (1000 * 60 * 60 * 24));
  if (ageDays <= policy.scoring.freshness.recentDays) {
    return policy.scoring.freshness.recentBoost;
  }
  if (ageDays >= policy.scoring.freshness.staleDays) {
    return -policy.scoring.freshness.stalePenalty;
  }

  return 0;
}

function buildBaseReasons(
  entry: AssetCatalogEntry,
  matchedSignals: RecommendationSignalMatch[],
  coverageTags: string[],
  taskModes: string[],
): string[] {
  const reasons = [
    `authority:${entry.source.authorityTier}`,
    `compatibility:${entry.compatibilityMode}`,
    `asset-kind:${entry.assetKind}`,
    `source:${deriveSourceFamily(entry)}`,
  ];

  for (const match of matchedSignals.slice(0, 4)) {
    reasons.push(`signal:${match.signalType}:${match.term}`);
  }

  for (const tag of coverageTags.slice(0, 4)) {
    reasons.push(`concern:${tag}`);
  }

  for (const taskMode of taskModes.slice(0, 3)) {
    reasons.push(`mode:${taskMode}`);
  }

  return reasons;
}

function calculateBreakdownTotal(
  breakdown: RecommendationScoreBreakdown,
): number {
  return Math.round(
    breakdown.authority +
      breakdown.compatibility +
      breakdown.portfolioFit +
      breakdown.trust +
      breakdown.sourcePriority +
      breakdown.demand +
      breakdown.hostPreference +
      breakdown.coverage +
      breakdown.diversity +
      breakdown.freshness -
      breakdown.costPenalty -
      breakdown.riskPenalty -
      breakdown.negativePenalty -
      breakdown.redundancyPenalty -
      breakdown.budgetPenalty,
  );
}

function deriveSourceFamily(entry: AssetCatalogEntry): string {
  const normalizedPublisher = normalizePhrase(entry.source.publisher);
  if (normalizedPublisher) {
    return normalizedPublisher;
  }

  return normalizePhrase(entry.source.sourceId);
}

function isSuppressedForHost(
  entry: AssetCatalogEntry,
  host: RecommendationHost,
  searchTerms: Set<string>,
  policy: RecommendationPolicy,
): boolean {
  const hostPolicy = policy.hosts[host];
  const normalizedAssetId = normalizePhrase(entry.id);

  if (
    hostPolicy.suppressedAssetIdPatterns.some((pattern) =>
      normalizedAssetId.includes(normalizePhrase(pattern)),
    )
  ) {
    return true;
  }

  return hostPolicy.suppressedCapabilityTerms.some((term) =>
    searchTerms.has(normalizePhrase(term)),
  );
}
