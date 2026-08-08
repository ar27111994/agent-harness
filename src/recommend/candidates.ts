import { SPECIALIZED_GATES } from "../domains/discovery/demand-helpers.js";
import { GENERIC_CAPABILITY_TERMS } from "./constants.js";
import {
  buildCoverageTags,
  buildDuplicateGroup,
  buildSearchTerms,
  buildSynonymLookup,
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
import type {
  CandidateRecommendation,
  CandidateRecommendationBase,
  DemandContext,
  PolicySearchContext,
} from "./model.js";

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
interface MatchQuality {
  exactStackWeight: number;
  ecosystemWeight: number;
  genericConcernWeight: number;
  hasOnlyGenericConcernMatch: boolean;
}

/**
 * Precomputes all policy-derived Set lookups so they are built once per host
 * run rather than once per candidate, eliminating the O(n × policy) hot path.
 */
export function buildPolicySearchContext(
  policy: RecommendationPolicy,
): PolicySearchContext {
  const synonymLookup = buildSynonymLookup(policy);
  const genericToolingTerms = buildGenericToolingTerms(policy, synonymLookup);
  const wrapperLikeTerms = buildSearchTerms(
    [...WRAPPER_LIKE_TERMS],
    policy,
    synonymLookup,
  );
  const concernTermSets = new Map<string, Set<string>>();
  const taskModeTermSets = new Map<string, Set<string>>();
  const domainGroupTermSets = new Map<string, Set<string>>();

  for (const [concern, keywords] of Object.entries(policy.concernKeywordMap)) {
    concernTermSets.set(
      concern,
      buildSearchTerms(keywords, policy, synonymLookup),
    );
  }
  for (const [mode, keywords] of Object.entries(policy.taskModeKeywordMap)) {
    taskModeTermSets.set(
      mode,
      buildSearchTerms(keywords, policy, synonymLookup),
    );
  }
  for (const [group, keywords] of Object.entries(policy.domainKeywordGroups)) {
    domainGroupTermSets.set(
      group,
      buildSearchTerms(keywords, policy, synonymLookup),
    );
  }

  return {
    genericToolingTerms,
    wrapperLikeTerms,
    concernTermSets,
    taskModeTermSets,
    domainGroupTermSets,
  };
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
 * Precomputes host-independent recommendation analysis for one catalog entry so
 * large report builds do not repeat the same demand/search work for every host.
 *
 * @param synonymLookup - Optional precomputed alias→canonical map built by
 *   `buildSynonymLookup`. Callers that process many entries should build this
 *   once and pass it here; omitting it causes a per-entry rebuild.
 */
export function buildCandidateRecommendationBase(
  entry: AssetCatalogEntry,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
  policyContext?: PolicySearchContext,
  synonymLookup?: Map<string, string>,
): CandidateRecommendationBase | null {
  const resolvedPolicyContext =
    policyContext ?? buildPolicySearchContext(policy);
  // Use the caller-provided synonym lookup when available; fall back to
  // building one here only for standalone / test call sites.
  const resolvedSynonymLookup = synonymLookup ?? buildSynonymLookup(policy);
  const capabilitySearchTerms = buildSearchTerms(
    [entry.id, entry.displayName, ...entry.capabilities],
    policy,
    resolvedSynonymLookup,
  );
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
    resolvedSynonymLookup,
  );

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
    resolvedPolicyContext.wrapperLikeTerms,
    resolvedPolicyContext.genericToolingTerms,
  );
  const availableLocally = isLocallyAvailable(entry);
  const recommendationBasis = determineRecommendationBasis(
    availableLocally,
    matchQuality,
  );
  const coverageTags = buildCoverageTags(
    searchTerms,
    matchedSignals,
    resolvedPolicyContext.concernTermSets,
  );
  const taskModes = buildTaskModes(
    searchTerms,
    coverageTags,
    matchedSignals,
    resolvedPolicyContext.taskModeTermSets,
    entry.contextCost,
  );
  const duplicateGroup = buildDuplicateGroup(
    entry.assetKind,
    matchedSignals,
    coverageTags,
    entry.dedupe.duplicateGroup,
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
    hostPreference: 0,
    coverage: 0,
    diversity: 0,
    assetKindDiversityPenalty: 0,
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
    negativePenalty: computeNegativePenalty(
      entry,
      searchTerms,
      matchedSignals,
      matchQuality,
      availableLocally,
      recommendationBasis,
      demandContext,
      policy,
      resolvedPolicyContext,
    ),
    ecosystemMismatchPenalty: computeEcosystemMismatchPenalty(
      entry,
      demandContext,
      policy.scoring.ecosystemMismatchPenalty,
    ),
    redundancyPenalty: 0,
    budgetPenalty: 0,
    total: 0,
  };
  breakdown.total = calculateBreakdownTotal(breakdown);

  return {
    entry,
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
    ),
    searchTerms,
    breakdown,
  };
}

/**
 * Builds candidate recommendation from precomputed entry analysis plus one host
 * specific scoring/suppression pass.
 */
export function buildCandidateRecommendation(
  base: CandidateRecommendationBase,
  host: RecommendationHost,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
  enforcedConcerns?: ReadonlySet<string>,
): CandidateRecommendation | null {
  if (isSuppressedForHost(base.entry, host, base.searchTerms, policy)) {
    return null;
  }

  const hostDeprioritizationPenalty = computeHostDeprioritizationPenalty(
    base.entry,
    host,
    base.searchTerms,
    policy,
  );
  const hostPreference = computeHostPreference(
    base.entry,
    host,
    base.coverageTags,
    demandContext,
    policy,
    enforcedConcerns,
  );
  const breakdown: RecommendationScoreBreakdown = {
    ...base.breakdown,
    hostPreference,
    negativePenalty:
      base.breakdown.negativePenalty + hostDeprioritizationPenalty,
    total: 0,
  };
  breakdown.total = calculateBreakdownTotal(breakdown);

  return {
    entry: base.entry,
    host,
    sourceFamily: base.sourceFamily,
    availableLocally: base.availableLocally,
    recommendationBasis: base.recommendationBasis,
    coverageTags: [...base.coverageTags],
    taskModes: [...base.taskModes],
    matchedSignals: base.matchedSignals.map((match) => ({
      ...match,
      ...(match.evidenceStrengthCounts
        ? { evidenceStrengthCounts: { ...match.evidenceStrengthCounts } }
        : {}),
    })),
    duplicateGroup: base.duplicateGroup,
    reasons: [...base.reasons],
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

function buildGenericToolingTerms(
  policy: RecommendationPolicy,
  synonymLookup?: Map<string, string>,
): Set<string> {
  const genericToolingTerms = new Set<string>(GENERIC_CAPABILITY_TERMS);

  for (const [concern, keywords] of Object.entries(policy.concernKeywordMap)) {
    for (const term of buildSearchTerms(
      [concern, ...keywords],
      policy,
      synonymLookup,
    )) {
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
  enforcedConcerns?: ReadonlySet<string>,
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
      (enforcedConcerns !== undefined
        ? enforcedConcerns.has(target.concern)
        : shouldEnforceConcernTarget(target.concern, demandContext, policy))
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
  policyContext: PolicySearchContext,
): number {
  let penalty = 0;

  if (entry.fit.portfolioFit < policy.scoring.lowFitPenaltyThreshold) {
    penalty += policy.scoring.lowFitPenalty;
  }

  if (demandContext.hasSignals && matchedSignals.length === 0) {
    penalty += policy.scoring.weakDemandPenalty;
  }

  penalty += computeOutOfDomainPenalty(
    searchTerms,
    demandContext,
    policyContext.domainGroupTermSets,
    policy.scoring.outOfDomainGroupPenalty,
  );

  const specificTerms = [...searchTerms].filter(
    (term) => !GENERIC_CAPABILITY_TERMS.has(term) && term.length > 2,
  );
  if (specificTerms.length < 3) {
    penalty += policy.scoring.genericCapabilityPenalty;
  }
  if (matchQuality.hasOnlyGenericConcernMatch) {
    penalty += Math.max(2, policy.scoring.genericCapabilityPenalty);
  }

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

function isSuppressedBySpecializedDemandGate(
  entry: AssetCatalogEntry,
  rawKeywordTerms: Set<string>,
  demandContext: DemandContext,
): boolean {
  if (entry.assetKind === "mcp-server") {
    return false;
  }

  return SPECIALIZED_GATES.some(
    (gate) =>
      matchesTermGroupSet(rawKeywordTerms, gate.entryTermGroups) &&
      !matchesTermGroupSetForDemandContext(
        demandContext,
        gate.demandTermGroups,
      ),
  );
}

/**
 * Maps source-id substrings (lowercased) to the package-manager family they
 * represent. Used to detect ecosystem mismatches between the asset's origin
 * registry and the workspace's detected package managers.
 *
 * Each entry is [sourceIdSubstring, packageManagerFamily]. The first match
 * wins. Families align with the values emitted by demand-signals.ts so that
 * a direct set-intersection with `demandContext.packageManagers` works.
 *
 * Order matters: more-specific substrings must come before any substring that
 * is a prefix of them (e.g. "pnpm" before "npm") so the first match is
 * correct. The array is iterated left-to-right when building the Map.
 */
const REGISTRY_ECOSYSTEM_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  // JavaScript / Node.js — must match "npm", "pnpm", "yarn", "bun" signals.
  // NOTE: "pnpm" must appear before any "npm*" entries because "pnpm" is a
  // substring of "pnpm-registry", while "npm-registry" and "npm" are also
  // substrings of it — first-match wins, so pnpm entries go first.
  ["pnpm", "pnpm"],
  ["npmjs", "npm"],
  ["npm-registry", "npm"],
  ["npm", "npm"],
  ["yarn", "yarn"],
  ["bun", "bun"],
  // PHP
  ["packagist", "composer"],
  // Python
  ["pypi", "pip"],
  // Ruby — demand-signals emits "bundler"
  ["rubygems", "bundler"],
  // .NET
  ["nuget", "nuget"],
  // Rust
  ["crates", "cargo"],
  ["cargo", "cargo"],
  // Dart / Flutter — demand-signals emits "pub"
  ["pub.dev", "pub"],
  ["pub-dev", "pub"],
  // Elixir — demand-signals emits "hex"
  ["hex.pm", "hex"],
  ["hex", "hex"],
  // Haskell — demand-signals emits "cabal" (rebar3 for Erlang is separate)
  ["hackage", "cabal"],
  // JVM — demand-signals emits "maven-gradle"
  ["maven", "maven-gradle"],
  ["gradle", "maven-gradle"],
  // iOS / macOS — demand-signals emits "cocoapods"
  ["cocoapods", "cocoapods"],
  // Swift — demand-signals emits "swiftpm"
  ["swift-package", "swiftpm"],
  ["swiftpackageindex", "swiftpm"],
  ["swift", "swiftpm"],
  // C / C++
  ["conan", "conan"],
  ["vcpkg", "vcpkg"],
] as const;

/**
 * Ordered substring scan from source-id → package-manager family.
 *
 * Because a single source ID may match multiple substrings (e.g. an ID
 * containing both "pnpm" and "npm"), we cannot index by the source ID
 * directly. Instead we keep the ordered array for correctness and iterate it
 * The array has ~25 entries — a single .find() pass is negligible.
 * relative to catalog size and far cheaper than the previous .find() on every
 * catalog entry.
 */
/**
 * Returns the penalty to apply when an asset's source registry belongs to a
 * package-manager ecosystem that the workspace does not use.
 *
 * No penalty is applied when:
 * - The source is not a package registry (repo, docs, local-* kinds are
 *   ecosystem-agnostic and should not be penalised).
 * - The workspace has no package-manager signals (brand-new workspace or
 *   language-only project — be conservative and don't penalise).
 * - The source's ecosystem cannot be mapped (unknown / internal registries).
 * - The workspace uses the matching package manager.
 *
 * When the workspace has package-manager signals but none of them match the
 * registry's ecosystem, a **total mismatch** is confirmed and 2× the base
 * penalty is applied. This prevents wrong-language package-registry entries
 * from surviving ranking when they happen to share keyword tokens with the
 * workspace (e.g. PHP Composer packages named after JavaScript tools in an
 * npm workspace). The doubled penalty ensures that even a demand-cap-saturated
 * PHP entry (score ≈ 44 before penalty) drops to a negative total while a
 * correctly-ecosystemed npm entry is unaffected.
 */
function computeEcosystemMismatchPenalty(
  entry: AssetCatalogEntry,
  demandContext: DemandContext,
  penalty: number,
): number {
  if (entry.source.sourceKind !== "package-registry") {
    return 0;
  }
  if (demandContext.packageManagers.size === 0) {
    return 0;
  }
  const sourceIdLower = entry.source.sourceId.toLowerCase();
  const sourceIdMatch = REGISTRY_ECOSYSTEM_ENTRIES.find(([substring]) =>
    sourceIdLower.includes(substring),
  );
  if (!sourceIdMatch) {
    return 0;
  }
  const [, family] = sourceIdMatch;
  if (demandContext.packageManagers.has(family)) {
    return 0;
  }
  // Total ecosystem mismatch: the workspace has package-manager signals but
  // none belong to this registry's ecosystem. Double the penalty so wrong-
  // registry entries cannot crowd out correct-ecosystem results even when
  // their display names overlap heavily with the workspace's keyword set.
  return penalty * 2;
}

function isSuppressedByDependencySelfEcho(
  entry: AssetCatalogEntry,
  demandContext: DemandContext,
): boolean {
  return Boolean(
    entry.source.sourceKind === "package-registry" &&
    entry.install.manifestEntry &&
    demandContext.packageManifestEntries.has(
      normalizePhrase(entry.install.manifestEntry),
    ),
  );
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
      breakdown.assetKindDiversityPenalty -
      breakdown.costPenalty -
      breakdown.riskPenalty -
      breakdown.negativePenalty -
      breakdown.ecosystemMismatchPenalty -
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

/**
 * Exposes narrow candidates internals for focused ecosystem-penalty tests.
 */
export const candidatesInternals = {
  computeEcosystemMismatchPenalty,
};
