import { GENERIC_CAPABILITY_TERMS } from "./constants.js";
import {
  buildCoverageTags,
  buildDuplicateGroup,
  buildSearchTerms,
  buildTaskModes,
  collectMatchedSignals,
  computeOutOfDomainPenalty,
  normalizePhrase,
  shouldEnforceConcernTarget,
} from "./signals.js";
import type {
  AssetCatalogEntry,
  RecommendationBasis,
  RecommendationPolicy,
  RecommendationScoreBreakdown,
  RecommendationSignalMatch,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";
import type { CandidateRecommendation, DemandContext } from "./model.js";

const WRAPPER_LIKE_TERMS = new Set([
  "config",
  "docs",
  "json",
  "knowledge",
  "reference",
  "scenario",
  "wrapper",
  "yaml",
  "yml",
]);
const SPECIALIZED_RECOMMENDATION_GATES = [
  {
    demandTerms: [["firebase"]],
    entryTerms: [["firebase"]],
  },
  {
    demandTerms: [["azure"]],
    entryTerms: [["azure"]],
  },
  {
    demandTerms: [["kubernetes"], ["helm"], ["k8s"]],
    entryTerms: [["kubernetes"], ["helm"], ["k8s"]],
  },
  {
    demandTerms: [
      ["dataverse"],
      ["power", "platform"],
      ["power", "apps"],
      ["power", "bi"],
    ],
    entryTerms: [
      ["dataverse"],
      ["power", "platform"],
      ["power", "apps"],
      ["power", "bi"],
    ],
  },
] as const;

interface MatchQuality {
  exactStackWeight: number;
  ecosystemWeight: number;
  genericConcernWeight: number;
  hasOnlyGenericConcernMatch: boolean;
}

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
  const capabilitySearchTerms = buildSearchTerms(
    [entry.id, entry.displayName, ...entry.capabilities],
    policy,
  );
  const genericToolingTerms = buildGenericToolingTerms(policy);
  const wrapperLikeTerms = buildSearchTerms([...WRAPPER_LIKE_TERMS], policy);
  const rawKeywordTerms = buildRawKeywordTerms([
    entry.id,
    entry.displayName,
    ...entry.capabilities,
    entry.install.relativePath ?? "",
    entry.evidence.filePath ?? "",
  ]);
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
  if (
    isSuppressedBySpecializedDemandGate(entry, rawKeywordTerms, demandContext)
  ) {
    return null;
  }
  if (isSuppressedForDesignSystemDemand(rawKeywordTerms, demandContext)) {
    return null;
  }
  if (isSuppressedByDependencySelfEcho(entry, demandContext)) {
    return null;
  }

  const matchedSignals = collectMatchedSignals(
    searchTerms,
    demandContext,
    policy,
  );
  const matchQuality = analyzeMatchQuality(
    matchedSignals,
    capabilitySearchTerms,
    wrapperLikeTerms,
    genericToolingTerms,
  );
  const availableLocally = isLocallyAvailable(entry);
  const recommendationBasis = determineRecommendationBasis(
    availableLocally,
    matchQuality,
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
  const dependencySelfEchoPenalty = computeDependencySelfEchoPenalty(
    entry,
    demandContext,
  );

  const breakdown: RecommendationScoreBreakdown = {
    authority: policy.scoring.authorityWeights[entry.source.authorityTier],
    compatibility: policy.scoring.compatibilityWeights[entry.compatibilityMode],
    portfolioFit:
      Math.round(
        (entry.fit.portfolioFit * 0.7 + entry.fit.hostFit * 0.3) *
          policy.scoring.portfolioFitMultiplier,
      ) + computePortfolioFitBonus(matchQuality),
    trust: Math.round(entry.trust.score / policy.scoring.trustDivisor),
    sourcePriority: Math.round(
      entry.source.sourcePriority / policy.scoring.sourcePriorityDivisor,
    ),
    demand: Math.min(
      policy.scoring.demandMatchCap,
      matchedSignals.reduce((total, match) => total + match.weight, 0) +
        computeDemandExactnessBonus(matchQuality),
    ),
    hostPreference: computeHostPreference(
      entry,
      host,
      coverageTags,
      demandContext,
      policy,
    ),
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
        matchQuality,
        availableLocally,
        recommendationBasis,
        demandContext,
        policy,
      ) +
      hostDeprioritizationPenalty +
      dependencySelfEchoPenalty,
    redundancyPenalty: 0,
    budgetPenalty: 0,
    total: 0,
  };
  breakdown.total = calculateBreakdownTotal(breakdown);

  return {
    entry,
    host,
    sourceFamily: deriveSourceFamily(entry),
    availableLocally,
    recommendationBasis,
    coverageTags,
    taskModes,
    matchedSignals,
    duplicateGroup,
    reasons: buildBaseReasons(
      entry,
      matchedSignals,
      coverageTags,
      taskModes,
      matchQuality,
      availableLocally,
      recommendationBasis,
      dependencySelfEchoPenalty,
    ),
    breakdown,
  };
}

function analyzeMatchQuality(
  matchedSignals: RecommendationSignalMatch[],
  capabilitySearchTerms: Set<string>,
  wrapperLikeTerms: Set<string>,
  genericToolingTerms: Set<string>,
): MatchQuality {
  const exactnessEligible = !isWrapperLikeAsset(
    capabilitySearchTerms,
    wrapperLikeTerms,
  );
  let exactStackWeight = 0;
  let ecosystemWeight = 0;
  let genericConcernWeight = 0;

  for (const match of matchedSignals) {
    if (exactnessEligible) {
      if (
        match.signalType === "frameworks" ||
        match.signalType === "packageManagers"
      ) {
        exactStackWeight += match.weight;
        continue;
      }

      if (
        match.signalType === "tooling" &&
        isSpecificToolingSignal(match.term, genericToolingTerms)
      ) {
        exactStackWeight += match.weight;
        continue;
      }
    }

    if (match.signalType === "languages") {
      ecosystemWeight += match.weight;
      continue;
    }

    if (match.signalType === "concerns") {
      genericConcernWeight += match.weight;
    }
  }

  return {
    exactStackWeight,
    ecosystemWeight,
    genericConcernWeight,
    hasOnlyGenericConcernMatch:
      genericConcernWeight > 0 &&
      exactStackWeight === 0 &&
      ecosystemWeight === 0,
  };
}

function isWrapperLikeAsset(
  capabilitySearchTerms: Set<string>,
  wrapperLikeTerms: Set<string>,
): boolean {
  for (const term of capabilitySearchTerms) {
    if (wrapperLikeTerms.has(term)) {
      return true;
    }
  }

  return false;
}

function buildGenericToolingTerms(policy: RecommendationPolicy): Set<string> {
  const genericToolingTerms = new Set<string>(GENERIC_CAPABILITY_TERMS);

  for (const [concern, keywords] of Object.entries(policy.concernKeywordMap)) {
    for (const term of buildSearchTerms([concern, ...keywords], policy)) {
      genericToolingTerms.add(term);
    }
  }

  return genericToolingTerms;
}

function isSpecificToolingSignal(
  term: string,
  genericToolingTerms: Set<string>,
): boolean {
  return !genericToolingTerms.has(normalizePhrase(term));
}

function isLocallyAvailable(entry: AssetCatalogEntry): boolean {
  return (
    entry.source.authorityTier === "trusted-local" ||
    entry.source.sourceKind === "local-directory" ||
    entry.source.sourceKind === "local-manifest"
  );
}

function determineRecommendationBasis(
  availableLocally: boolean,
  matchQuality: MatchQuality,
): RecommendationBasis {
  if (
    availableLocally &&
    matchQuality.exactStackWeight === 0 &&
    matchQuality.ecosystemWeight === 0
  ) {
    return "local-availability";
  }

  return "workspace-fit";
}

function computePortfolioFitBonus(matchQuality: MatchQuality): number {
  if (matchQuality.exactStackWeight > 0) {
    return matchQuality.exactStackWeight * 5 + matchQuality.ecosystemWeight * 2;
  }

  if (matchQuality.ecosystemWeight > 0) {
    return matchQuality.ecosystemWeight;
  }

  return 0;
}

function computeDemandExactnessBonus(matchQuality: MatchQuality): number {
  if (matchQuality.exactStackWeight > 0) {
    return matchQuality.exactStackWeight * 4 + matchQuality.ecosystemWeight;
  }

  return 0;
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
  demandContext: DemandContext,
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
    if (
      coverageTags.includes(target.concern) &&
      shouldEnforceConcernTarget(target.concern, demandContext, policy)
    ) {
      score += Math.max(1, Math.round(target.weight / 2));
    }
  }

  return score;
}

function computeNegativePenalty(
  entry: AssetCatalogEntry,
  searchTerms: Set<string>,
  matchedSignals: RecommendationSignalMatch[],
  matchQuality: MatchQuality,
  availableLocally: boolean,
  recommendationBasis: RecommendationBasis,
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
  if (matchQuality.hasOnlyGenericConcernMatch) {
    penalty += Math.max(2, policy.scoring.genericCapabilityPenalty);
  }

  penalty += computeDesignSystemGenericMobilePenalty(
    searchTerms,
    demandContext,
    matchQuality,
  );

  if (recommendationBasis === "local-availability") {
    penalty += Math.max(
      policy.scoring.weakDemandPenalty,
      policy.scoring.genericCapabilityPenalty + 4,
    );
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

function computeDependencySelfEchoPenalty(
  entry: AssetCatalogEntry,
  demandContext: DemandContext,
): number {
  if (
    entry.source.sourceKind !== "package-registry" ||
    !entry.install.manifestEntry
  ) {
    return 0;
  }

  return demandContext.packageManifestEntries.has(
    normalizePhrase(entry.install.manifestEntry),
  )
    ? 28
    : 0;
}

function isSuppressedBySpecializedDemandGate(
  entry: AssetCatalogEntry,
  rawKeywordTerms: Set<string>,
  demandContext: DemandContext,
): boolean {
  if (entry.assetKind === "mcp-server") {
    return false;
  }

  return SPECIALIZED_RECOMMENDATION_GATES.some(
    (gate) =>
      matchesTermGroupSet(rawKeywordTerms, gate.entryTerms) &&
      !matchesTermGroupSetForDemandContext(demandContext, gate.demandTerms),
  );
}

function isSuppressedByDependencySelfEcho(
  entry: AssetCatalogEntry,
  demandContext: DemandContext,
): boolean {
  return computeDependencySelfEchoPenalty(entry, demandContext) > 0;
}

function matchesTermGroupSet(
  terms: Set<string>,
  termGroups: readonly (readonly string[])[],
): boolean {
  return termGroups.some((group) => group.every((term) => terms.has(term)));
}

function matchesTermGroupSetForDemandContext(
  demandContext: DemandContext,
  termGroups: readonly (readonly string[])[],
): boolean {
  return termGroups.some((group) =>
    group.every((term) =>
      demandContext.demandKeywords.has(normalizePhrase(term)),
    ),
  );
}

function buildRawKeywordTerms(values: string[]): Set<string> {
  const terms = new Set<string>();

  for (const value of values) {
    const normalizedPhrase = normalizePhrase(value);
    if (normalizedPhrase) {
      terms.add(normalizedPhrase);
    }

    for (const token of value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((part) => part.length > 1)) {
      terms.add(normalizePhrase(token));
    }
  }

  return terms;
}

function computeDesignSystemGenericMobilePenalty(
  searchTerms: Set<string>,
  demandContext: DemandContext,
  matchQuality: MatchQuality,
): number {
  if (!demandContext.demandKeywords.has("penpot")) {
    return 0;
  }

  if (matchQuality.exactStackWeight > 0) {
    return 0;
  }

  return isGenericMobileOnlyAsset(searchTerms) ? 40 : 0;
}

function isSuppressedForDesignSystemDemand(
  rawKeywordTerms: Set<string>,
  demandContext: DemandContext,
): boolean {
  return (
    demandContext.demandKeywords.has("penpot") &&
    isGenericMobileOnlyAsset(rawKeywordTerms)
  );
}

function isGenericMobileOnlyAsset(searchTerms: Set<string>): boolean {
  return (
    searchTerms.has("mobile") &&
    (searchTerms.has("android") || searchTerms.has("ios")) &&
    !searchTerms.has("design") &&
    !searchTerms.has("design-systems") &&
    !searchTerms.has("penpot")
  );
}

function buildBaseReasons(
  entry: AssetCatalogEntry,
  matchedSignals: RecommendationSignalMatch[],
  coverageTags: string[],
  taskModes: string[],
  matchQuality: MatchQuality,
  availableLocally: boolean,
  recommendationBasis: RecommendationBasis,
  dependencySelfEchoPenalty: number,
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

  if (matchQuality.exactStackWeight > 0) {
    reasons.push("fit:exact-stack");
  } else if (matchQuality.ecosystemWeight > 0) {
    reasons.push("fit:ecosystem");
  } else if (matchQuality.genericConcernWeight > 0) {
    reasons.push("fit:generic-concern");
  }

  if (availableLocally) {
    reasons.push("availability:local");
  }
  if (dependencySelfEchoPenalty > 0) {
    reasons.push("risk:self-echo");
  }
  reasons.push(`basis:${recommendationBasis}`);

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
