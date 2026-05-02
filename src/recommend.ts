import { join } from "node:path";

import {
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
} from "./files.js";
import {
  assertRecommendationHostPolicyOverride,
  assertRecommendationPolicy,
  assertRecommendationPolicyBase,
  assertRecommendationReport,
} from "./manifest-validation.js";
import { buildRecommendationFixtures } from "./recommend-fixtures.js";
import type {
  AssetCatalogEntry,
  AssetContextCost,
  AssetKind,
  DemandProfile,
  RecommendationEntry,
  RecommendationEvaluationCheck,
  RecommendationEvaluationExpectation,
  RecommendationEvaluationFixture,
  RecommendationEvaluationResult,
  RecommendationHostSummary,
  RecommendationHostPolicy,
  RecommendationHostPolicyOverride,
  RecommendationPolicy,
  RecommendationPolicyBase,
  RecommendationPolicyPresetRefs,
  RecommendationPolicyPresets,
  RecommendationReport,
  RecommendationScoreBreakdown,
  RecommendationSignalMatch,
  RecommendationSignalType,
  RecommendationSuggestedBundle,
  RecommendationTargetAssetKindPreference,
  RecommendationTargetConcernPreference,
  HostTarget,
} from "./types.js";

const LEGACY_POLICY_FILE_PATH = [
  "discover",
  "recommendation-policy.json",
] as const;
const POLICY_BASE_FILE_PATH = [
  "discover",
  "recommendation-policy",
  "base.json",
] as const;
const POLICY_HOST_DIRECTORY_PATH = [
  "discover",
  "recommendation-policy",
  "hosts",
] as const;
const REPORT_FILE_PATH = ["state", "recommendations.json"] as const;
const EVALUATION_FILE_PATH = [
  "state",
  "recommendation-evaluation.json",
] as const;
const RECOMMENDATION_HOSTS = [
  "opencode",
  "copilot-vscode",
  "shared",
  "cursor",
  "zed",
  "claude-code",
  "pi",
] as const satisfies readonly HostTarget[];
const FOCUSED_BUCKET_LIMIT = 20;
const GENERIC_CAPABILITY_TERMS = new Set([
  "agent",
  "agents",
  "ai",
  "code",
  "developer",
  "development",
  "everything",
  "first",
  "guide",
  "harness",
  "llm",
  "productivity",
  "research",
  "skill",
  "system",
  "tool",
  "tools",
]);

type RecommendationHost = (typeof RECOMMENDATION_HOSTS)[number];

interface DemandTermContext {
  key: string;
  canonicalTerm: string;
  signalType: RecommendationSignalType;
  evidenceCount: number;
  matchTerms: Set<string>;
}

interface DemandContext {
  terms: DemandTermContext[];
  hasSignals: boolean;
  activeDomainGroups: Set<string>;
}

interface CandidateRecommendation {
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

interface DynamicScore {
  total: number;
  coverage: number;
  diversity: number;
  redundancyPenalty: number;
  budgetPenalty: number;
}

export async function runRecommend(
  args: string[],
  _workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "report", ...rest] = args;

  switch (command) {
    case "report": {
      const report = await writeRecommendationReport(projectRoot);
      const totalEntries = Object.values(report.topByHost).reduce(
        (total, entries) => total + entries.length,
        0,
      );
      console.log(
        `Recommendation report written to ${join(projectRoot, ...REPORT_FILE_PATH)} (${totalEntries} ranked entries)`,
      );
      return 0;
    }
    case "explain":
      await explainRecommendation(projectRoot, rest);
      return 0;
    case "evaluate": {
      const exitCode = await evaluateRecommendationFixtures(projectRoot, rest);
      return exitCode;
    }
    case "policy:print":
      await printRecommendationPolicy(projectRoot, rest);
      return 0;
    case "help":
      printRecommendHelp();
      return 0;
    default:
      printRecommendHelp();
      return 1;
  }
}

export async function writeRecommendationReport(
  projectRoot: string,
): Promise<RecommendationReport> {
  const policy = await loadRecommendationPolicy(projectRoot);
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
  );
  const report = buildRecommendationReport(
    selectedEntries,
    demandProfile,
    policy,
  );

  await writeJsonFile(join(projectRoot, ...REPORT_FILE_PATH), report);

  return report;
}

export function buildRecommendationReport(
  entries: AssetCatalogEntry[],
  demandProfile: DemandProfile | null,
  policy: RecommendationPolicy,
): RecommendationReport {
  const demandContext = buildDemandContext(demandProfile, policy);
  const topByHost = Object.fromEntries(
    RECOMMENDATION_HOSTS.map((host) => [
      host,
      buildTopRecommendationsForHost(host, entries, demandContext, policy),
    ]),
  ) as Record<RecommendationHost, RecommendationEntry[]>;
  const hostSummaries = Object.fromEntries(
    RECOMMENDATION_HOSTS.map((host) => [
      host,
      buildHostSummary(host, topByHost[host], policy),
    ]),
  ) as Record<RecommendationHost, RecommendationHostSummary>;
  const suggestedBundles = RECOMMENDATION_HOSTS.map((host) =>
    buildSuggestedBundle(host, topByHost[host], policy),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: policy.schemaVersion,
    topByHost,
    hostSummaries,
    suggestedBundles,
  };
}

function buildTopRecommendationsForHost(
  host: RecommendationHost,
  entries: AssetCatalogEntry[],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): RecommendationEntry[] {
  const candidates = entries
    .filter((entry) => isEntryCompatibleWithRecommendationHost(entry, host))
    .filter((entry) => entry.compatibilityMode !== "incompatible")
    .sort(
      (left, right) =>
        computeEntryPreselectionScore(right) -
          computeEntryPreselectionScore(left) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, getHostPreselectionLimit(host, policy))
    .map((entry) =>
      buildCandidateRecommendation(entry, host, demandContext, policy),
    )
    .filter(
      (candidate): candidate is CandidateRecommendation => candidate !== null,
    )
    .sort(
      (left, right) =>
        right.breakdown.total - left.breakdown.total ||
        left.entry.id.localeCompare(right.entry.id),
    );

  const selectedCandidates = selectCandidatesForHost(host, candidates, policy);

  return selectedCandidates.map((candidate, index) => ({
    assetId: candidate.entry.id,
    host,
    rank: index + 1,
    score: candidate.breakdown.total,
    reasons: candidate.reasons,
    assetKind: candidate.entry.assetKind,
    sourceId: candidate.entry.source.sourceId,
    sourceFamily: candidate.sourceFamily,
    contextSizeClass: candidate.entry.contextCost.sizeClass,
    estimatedPromptWeight: candidate.entry.contextCost.estimatedPromptWeight,
    duplicateGroup: candidate.duplicateGroup,
    selectionStage: "top-by-host",
    coverageTags: candidate.coverageTags,
    taskModes: candidate.taskModes,
    matchedSignals: candidate.matchedSignals,
    scoreBreakdown: candidate.breakdown,
  }));
}

function computeEntryPreselectionScore(entry: AssetCatalogEntry): number {
  return (
    entry.trust.score +
    entry.source.sourcePriority +
    entry.fit.portfolioFit * 100 +
    entry.fit.hostFit * 60 -
    entry.contextCost.estimatedPromptWeight -
    (entry.risk.level === "high" ? 24 : entry.risk.level === "medium" ? 10 : 0)
  );
}

function getHostPreselectionLimit(
  host: RecommendationHost,
  policy: RecommendationPolicy,
): number {
  return Math.max(250, policy.hosts[host].recommendationLimit * 3);
}

function isEntryCompatibleWithRecommendationHost(
  entry: AssetCatalogEntry,
  host: RecommendationHost,
): boolean {
  if (entry.hosts.includes(host)) {
    return true;
  }

  if (host === "cursor") {
    return entry.hosts.includes("copilot-vscode");
  }

  if (host === "zed" || host === "claude-code" || host === "pi") {
    return entry.hosts.includes("opencode");
  }

  return false;
}

function selectCandidatesForHost(
  host: RecommendationHost,
  candidates: CandidateRecommendation[],
  policy: RecommendationPolicy,
): CandidateRecommendation[] {
  const hostPolicy = policy.hosts[host];
  const selected: CandidateRecommendation[] = [];
  const remaining = [...candidates];

  while (
    selected.length < hostPolicy.recommendationLimit &&
    remaining.length > 0
  ) {
    let bestIndex = -1;
    let bestScore: DynamicScore | null = null;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (exceedsHostCaps(candidate, selected, hostPolicy, false)) {
        continue;
      }

      const candidateScore = scoreCandidateAgainstSelection(
        candidate,
        selected,
        hostPolicy,
        policy,
        false,
      );
      const currentBest = bestIndex === -1 ? null : remaining[bestIndex];
      if (
        !bestScore ||
        compareDynamicScores(
          candidateScore,
          bestScore,
          candidate,
          currentBest,
        ) < 0
      ) {
        bestIndex = index;
        bestScore = candidateScore;
      }
    }

    if (bestIndex === -1 || !bestScore) {
      break;
    }

    const [chosenCandidate] = remaining.splice(bestIndex, 1);
    selected.push(applyDynamicScore(chosenCandidate, bestScore));
  }

  if (selected.length >= hostPolicy.recommendationLimit) {
    return selected;
  }

  for (const candidate of remaining) {
    if (selected.length >= hostPolicy.recommendationLimit) {
      break;
    }
    if (exceedsHostCaps(candidate, selected, hostPolicy, true)) {
      continue;
    }

    const fallbackScore = scoreCandidateAgainstSelection(
      candidate,
      selected,
      hostPolicy,
      policy,
      true,
    );
    selected.push(applyDynamicScore(candidate, fallbackScore));
  }

  return selected;
}

function buildCandidateRecommendation(
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

function scoreCandidateAgainstSelection(
  candidate: CandidateRecommendation,
  selected: CandidateRecommendation[],
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
  policy: RecommendationPolicy,
  relaxed: boolean,
): DynamicScore {
  const coverage = computeCoverageGain(candidate, selected, hostPolicy, policy);
  const diversity = selected.some(
    (entry) => entry.sourceFamily === candidate.sourceFamily,
  )
    ? 0
    : policy.scoring.sourceDiversityBonus;
  const redundancyPenalty = computeRedundancyPenalty(
    candidate,
    selected,
    hostPolicy,
    policy,
  );
  const budgetPenalty =
    candidate.entry.contextCost.estimatedPromptWeight >
    hostPolicy.activationBudget / 3
      ? Math.max(
          1,
          Math.round(candidate.entry.contextCost.estimatedPromptWeight / 2),
        )
      : 0;

  return {
    total:
      candidate.breakdown.total +
      coverage +
      diversity -
      redundancyPenalty -
      (relaxed ? 0 : budgetPenalty),
    coverage,
    diversity,
    redundancyPenalty,
    budgetPenalty: relaxed ? 0 : budgetPenalty,
  };
}

function computeCoverageGain(
  candidate: CandidateRecommendation,
  selected: CandidateRecommendation[],
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
  policy: RecommendationPolicy,
): number {
  let score = 0;
  const selectedKinds = countBy(selected, (entry) => entry.entry.assetKind);
  const selectedConcerns = countCoverageTags(selected);

  for (const target of hostPolicy.targetAssetKinds) {
    if (
      target.assetKind === candidate.entry.assetKind &&
      (selectedKinds[target.assetKind] ?? 0) < target.minimum
    ) {
      score += target.weight * policy.scoring.coverageGainWeight;
    }
  }

  for (const target of hostPolicy.targetConcerns) {
    if (
      candidate.coverageTags.includes(target.concern) &&
      (selectedConcerns[target.concern] ?? 0) < target.minimum
    ) {
      score += target.weight * policy.scoring.coverageGainWeight;
    }
  }

  return score;
}

function computeRedundancyPenalty(
  candidate: CandidateRecommendation,
  selected: CandidateRecommendation[],
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
  policy: RecommendationPolicy,
): number {
  let overlapCount = 0;
  const sameSourceFamilyCount = selected.filter(
    (entry) => entry.sourceFamily === candidate.sourceFamily,
  ).length;

  for (const entry of selected) {
    if (entry.sourceFamily === candidate.sourceFamily) {
      overlapCount += 1;
    }
    if (
      candidate.duplicateGroup &&
      entry.duplicateGroup &&
      candidate.duplicateGroup === entry.duplicateGroup
    ) {
      overlapCount += 2;
    }
    overlapCount += Math.min(
      2,
      candidate.coverageTags.filter((tag) => entry.coverageTags.includes(tag))
        .length,
    );
  }

  const basePenalty = overlapCount * policy.scoring.overlapPenalty;
  const sourceSaturationPenalty = computeSourceSaturationPenalty(
    sameSourceFamilyCount,
    hostPolicy,
  );

  return basePenalty + sourceSaturationPenalty;
}

function computeSourceSaturationPenalty(
  sameSourceFamilyCount: number,
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
): number {
  const freeCount = hostPolicy.sourceSaturationFreeCount ?? 0;
  const penaltyStep = hostPolicy.sourceSaturationPenaltyStep ?? 0;
  if (penaltyStep <= 0 || sameSourceFamilyCount < freeCount) {
    return 0;
  }

  return (sameSourceFamilyCount - freeCount + 1) * penaltyStep;
}

function exceedsHostCaps(
  candidate: CandidateRecommendation,
  selected: CandidateRecommendation[],
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
  relaxed: boolean,
): boolean {
  const selectedKinds = countBy(selected, (entry) => entry.entry.assetKind);
  const assetKindCap = hostPolicy.maxPerAssetKind[candidate.entry.assetKind];
  if (
    assetKindCap !== undefined &&
    (selectedKinds[candidate.entry.assetKind] ?? 0) >= assetKindCap
  ) {
    return true;
  }

  if (relaxed) {
    return false;
  }

  if (
    selected.filter((entry) => entry.sourceFamily === candidate.sourceFamily)
      .length >= hostPolicy.maxPerSourceFamily
  ) {
    return true;
  }

  if (
    candidate.duplicateGroup &&
    selected.filter(
      (entry) => entry.duplicateGroup === candidate.duplicateGroup,
    ).length >= hostPolicy.maxPerDuplicateGroup
  ) {
    return true;
  }

  return false;
}

function applyDynamicScore(
  candidate: CandidateRecommendation,
  score: DynamicScore,
): CandidateRecommendation {
  const breakdown: RecommendationScoreBreakdown = {
    ...candidate.breakdown,
    coverage: score.coverage,
    diversity: score.diversity,
    redundancyPenalty: score.redundancyPenalty,
    budgetPenalty: score.budgetPenalty,
    total: Math.round(score.total),
  };
  const reasons = [...candidate.reasons];
  if (score.coverage > 0) {
    reasons.push("coverage-gap-fill");
  }
  if (score.diversity > 0) {
    reasons.push("source-diversity");
  }
  if (score.redundancyPenalty > 0) {
    reasons.push("redundancy-controlled");
  }

  return {
    ...candidate,
    reasons,
    breakdown,
  };
}

function compareDynamicScores(
  left: DynamicScore,
  right: DynamicScore,
  leftCandidate: CandidateRecommendation,
  rightCandidate: CandidateRecommendation | null,
): number {
  if (left.total !== right.total) {
    return right.total - left.total;
  }

  const rightWeight =
    rightCandidate?.entry.contextCost.estimatedPromptWeight ??
    Number.MAX_SAFE_INTEGER;
  if (leftCandidate.entry.contextCost.estimatedPromptWeight !== rightWeight) {
    return leftCandidate.entry.contextCost.estimatedPromptWeight - rightWeight;
  }

  return leftCandidate.entry.id.localeCompare(
    rightCandidate?.entry.id ?? leftCandidate.entry.id,
  );
}

function collectMatchedSignals(
  searchTerms: Set<string>,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): RecommendationSignalMatch[] {
  return demandContext.terms
    .filter((term) => intersects(searchTerms, term.matchTerms))
    .map((term) => {
      const baseWeight =
        policy.scoring.demandSignalWeights[term.signalType] *
        Math.min(3, term.evidenceCount);
      const termMultiplier =
        policy.scoring.demandTermMultipliers[term.canonicalTerm] ?? 1;

      return {
        term: term.canonicalTerm,
        signalType: term.signalType,
        weight: Math.max(1, Math.round(baseWeight * termMultiplier)),
        evidenceCount: term.evidenceCount,
      };
    })
    .sort(
      (left, right) =>
        right.weight - left.weight || left.term.localeCompare(right.term),
    );
}

function buildDemandContext(
  demandProfile: DemandProfile | null,
  policy: RecommendationPolicy,
): DemandContext {
  if (!demandProfile) {
    return {
      terms: [],
      hasSignals: false,
      activeDomainGroups: new Set<string>(),
    };
  }

  const demandTermMap = new Map<string, DemandTermContext>();

  const registerTerm = (
    signalType: RecommendationSignalType,
    rawTerm: string,
    evidenceIncrement: number,
  ): void => {
    const canonicalTerm = canonicalizePhrase(rawTerm, policy);
    const key = `${signalType}:${canonicalTerm}`;
    const matchTerms = buildSearchTerms([rawTerm], policy);
    const existing = demandTermMap.get(key);

    if (existing) {
      existing.evidenceCount += evidenceIncrement;
      for (const matchTerm of matchTerms) {
        existing.matchTerms.add(matchTerm);
      }
      return;
    }

    demandTermMap.set(key, {
      key,
      canonicalTerm,
      signalType,
      evidenceCount: evidenceIncrement,
      matchTerms,
    });
  };

  for (const signalType of recommendationSignalTypes()) {
    for (const rawTerm of demandProfile.signals[signalType]) {
      registerTerm(signalType, rawTerm, 1);
    }
  }

  for (const evidence of demandProfile.evidence) {
    for (const signalType of recommendationSignalTypes()) {
      for (const rawTerm of evidence.matchedSignals[signalType]) {
        registerTerm(signalType, rawTerm, 1);
      }
    }
  }

  const terms = [...demandTermMap.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  return {
    terms,
    hasSignals: demandTermMap.size > 0,
    activeDomainGroups: buildActiveDomainGroups(terms, policy),
  };
}

function buildActiveDomainGroups(
  terms: DemandTermContext[],
  policy: RecommendationPolicy,
): Set<string> {
  const activeGroups = new Set<string>();

  for (const [group, keywords] of Object.entries(policy.domainKeywordGroups)) {
    const groupTerms = buildSearchTerms(keywords, policy);
    if (terms.some((term) => intersects(term.matchTerms, groupTerms))) {
      activeGroups.add(group);
    }
  }

  return activeGroups;
}

function computeOutOfDomainPenalty(
  searchTerms: Set<string>,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): number {
  let penalty = 0;

  for (const [group, keywords] of Object.entries(policy.domainKeywordGroups)) {
    const groupTerms = buildSearchTerms(keywords, policy);
    if (!intersects(searchTerms, groupTerms)) {
      continue;
    }
    if (demandContext.activeDomainGroups.has(group)) {
      continue;
    }

    penalty += policy.scoring.outOfDomainGroupPenalty;
  }

  return penalty;
}

function buildCoverageTags(
  searchTerms: Set<string>,
  matchedSignals: RecommendationSignalMatch[],
  policy: RecommendationPolicy,
): string[] {
  const tags = new Set<string>();

  for (const [concern, keywords] of Object.entries(policy.concernKeywordMap)) {
    if (intersects(searchTerms, buildSearchTerms(keywords, policy))) {
      tags.add(concern);
    }
  }

  for (const match of matchedSignals) {
    if (match.signalType === "concerns") {
      tags.add(match.term);
    }
  }

  return [...tags].sort();
}

function buildTaskModes(
  searchTerms: Set<string>,
  coverageTags: string[],
  matchedSignals: RecommendationSignalMatch[],
  policy: RecommendationPolicy,
  contextCost: AssetContextCost,
): string[] {
  const modes = new Set<string>();

  for (const [mode, keywords] of Object.entries(policy.taskModeKeywordMap)) {
    if (intersects(searchTerms, buildSearchTerms(keywords, policy))) {
      modes.add(mode);
    }
  }

  if (coverageTags.includes("backend") || coverageTags.includes("frontend")) {
    modes.add("implementation");
  }
  if (coverageTags.includes("testing") || coverageTags.includes("security")) {
    modes.add("validation");
  }
  if (coverageTags.includes("infra")) {
    modes.add("operations");
  }
  if (coverageTags.includes("docs")) {
    modes.add("research");
  }
  if (
    coverageTags.includes("integration") ||
    coverageTags.includes("automation")
  ) {
    modes.add("automation");
  }
  if (matchedSignals.length > 0 && contextCost.estimatedPromptWeight <= 2) {
    modes.add("focused");
  }
  if (matchedSignals.length >= 3 || coverageTags.length >= 3) {
    modes.add("broad");
  }

  return [...modes].sort();
}

function buildDuplicateGroup(
  assetKind: AssetKind,
  matchedSignals: RecommendationSignalMatch[],
  coverageTags: string[],
  existingGroup?: string,
): string | undefined {
  if (existingGroup) {
    return existingGroup;
  }

  const primaryTerms = matchedSignals.map((match) => match.term).slice(0, 2);
  const fallbackTerms = coverageTags.slice(0, 2);
  const terms = primaryTerms.length > 0 ? primaryTerms : fallbackTerms;
  if (terms.length === 0) {
    return undefined;
  }

  return `${assetKind}:${terms.join("+")}`;
}

function buildHostSummary(
  host: RecommendationHost,
  entries: RecommendationEntry[],
  policy: RecommendationPolicy,
): RecommendationHostSummary {
  return {
    host,
    recommendationLimit: policy.hosts[host].recommendationLimit,
    activationBudget: policy.hosts[host].activationBudget,
    selectedCount: entries.length,
    totalEstimatedPromptWeight: entries.reduce(
      (total, entry) => total + entry.estimatedPromptWeight,
      0,
    ),
    selectedAssetIds: entries.map((entry) => entry.assetId),
    byAssetKind: countBy(entries, (entry) => entry.assetKind ?? "unknown"),
    bySourceFamily: countBy(entries, (entry) => entry.sourceFamily),
    byConcern: countCoverageTagsFromEntries(entries),
    concernBuckets: buildConcernBuckets(entries),
    taskModeBuckets: buildTaskModeBuckets(entries),
  };
}

function buildSuggestedBundle(
  host: RecommendationHost,
  entries: RecommendationEntry[],
  policy: RecommendationPolicy,
): RecommendationSuggestedBundle {
  const hostPolicy = policy.hosts[host];
  const selectedEntries = selectEntriesWithinBudget(
    entries,
    hostPolicy.activationBudget,
  );

  return {
    host,
    bundleId: hostPolicy.suggestedBundleId,
    assetIds: selectedEntries.map((entry) => entry.assetId),
    estimatedPromptWeight: selectedEntries.reduce(
      (total, entry) => total + entry.estimatedPromptWeight,
      0,
    ),
    concernBuckets: buildConcernBuckets(selectedEntries),
    taskModeBuckets: buildTaskModeBuckets(selectedEntries),
  };
}

function selectEntriesWithinBudget(
  entries: RecommendationEntry[],
  budget: number,
): RecommendationEntry[] {
  const selected: RecommendationEntry[] = [];
  let remainingBudget = budget;

  for (const entry of entries) {
    if (
      entry.estimatedPromptWeight <= remainingBudget ||
      selected.length === 0
    ) {
      selected.push(entry);
      remainingBudget -= entry.estimatedPromptWeight;
    }
  }

  return selected;
}

function buildConcernBuckets(
  entries: RecommendationEntry[],
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const entry of entries) {
    for (const tag of entry.coverageTags) {
      const bucket = buckets.get(tag) ?? [];
      bucket.push(entry.assetId);
      buckets.set(tag, bucket);
    }
  }

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
}

function buildTaskModeBuckets(
  entries: RecommendationEntry[],
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const entry of entries) {
    for (const taskMode of entry.taskModes) {
      const bucket = buckets.get(taskMode) ?? [];
      bucket.push(entry.assetId);
      buckets.set(taskMode, bucket);
    }
  }

  buckets.set(
    "focused",
    entries
      .slice(0, Math.min(FOCUSED_BUCKET_LIMIT, entries.length))
      .map((entry) => entry.assetId),
  );
  buckets.set(
    "broad",
    entries.map((entry) => entry.assetId),
  );

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
}

function countCoverageTags(
  entries: CandidateRecommendation[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.coverageTags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

function countCoverageTagsFromEntries(
  entries: RecommendationEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.coverageTags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

function countBy<T>(
  values: T[],
  selector: (value: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = selector(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
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

function buildSearchTerms(
  values: string[],
  policy: RecommendationPolicy,
): Set<string> {
  const searchTerms = new Set<string>();

  for (const value of values) {
    const normalizedPhrase = canonicalizePhrase(value, policy);
    if (normalizedPhrase) {
      searchTerms.add(normalizedPhrase);
    }

    for (const token of value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((part) => part.length > 1)) {
      searchTerms.add(canonicalizePhrase(token, policy));
    }
  }

  return searchTerms;
}

function canonicalizePhrase(
  value: string,
  policy: RecommendationPolicy,
): string {
  const normalizedValue = normalizePhrase(value);

  for (const [canonical, aliases] of Object.entries(policy.synonyms)) {
    const normalizedCanonical = normalizePhrase(canonical);
    if (normalizedCanonical === normalizedValue) {
      return normalizedCanonical;
    }
    if (aliases.some((alias) => normalizePhrase(alias) === normalizedValue)) {
      return normalizedCanonical;
    }
  }

  return normalizedValue;
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .trim();
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function recommendationSignalTypes(): RecommendationSignalType[] {
  return ["languages", "packageManagers", "frameworks", "concerns", "tooling"];
}

async function loadRecommendationPolicy(
  projectRoot: string,
): Promise<RecommendationPolicy> {
  const basePolicyPath = join(projectRoot, ...POLICY_BASE_FILE_PATH);
  const basePolicy =
    await readJsonFileOrNull<RecommendationPolicyBase>(basePolicyPath);

  if (!basePolicy) {
    return readJsonFile<RecommendationPolicy>(
      join(projectRoot, ...LEGACY_POLICY_FILE_PATH),
      assertRecommendationPolicy,
    );
  }

  assertRecommendationPolicyBase(basePolicy, basePolicyPath);

  const hostOverrides = await Promise.all(
    RECOMMENDATION_HOSTS.map(async (host) => {
      const overridePath = join(
        projectRoot,
        ...POLICY_HOST_DIRECTORY_PATH,
        `${host}.json`,
      );
      const override = await readJsonFile<RecommendationHostPolicyOverride>(
        overridePath,
        assertRecommendationHostPolicyOverride,
      );

      if (override.schemaVersion !== basePolicy.schemaVersion) {
        throw new Error(
          `Recommendation policy schema mismatch for ${host}: expected ${basePolicy.schemaVersion}, received ${override.schemaVersion}`,
        );
      }

      if (override.host !== host) {
        throw new Error(
          `Recommendation host policy file ${overridePath} declares host ${override.host} instead of ${host}`,
        );
      }

      return [host, override] as const;
    }),
  );

  const policy = buildRecommendationPolicyFromSplitFiles(
    basePolicy,
    Object.fromEntries(hostOverrides) as Record<
      RecommendationHost,
      RecommendationHostPolicyOverride
    >,
  );

  assertRecommendationPolicy(policy, "recommendation-policy");
  return policy;
}

function buildRecommendationPolicyFromSplitFiles(
  basePolicy: RecommendationPolicyBase,
  hostOverrides: Record<RecommendationHost, RecommendationHostPolicyOverride>,
): RecommendationPolicy {
  const hostDefaults = basePolicy.hostDefaults ?? {};
  const presets = basePolicy.presets;

  return {
    schemaVersion: basePolicy.schemaVersion,
    scoring: basePolicy.scoring,
    hosts: Object.fromEntries(
      RECOMMENDATION_HOSTS.map((host) => [
        host,
        mergeRecommendationHostPolicy(
          hostDefaults,
          buildRecommendationHostPolicyFromPresets(
            host,
            presets,
            hostOverrides[host].presetRefs,
          ),
          hostOverrides[host].policy,
        ),
      ]),
    ) as Record<RecommendationHost, RecommendationHostPolicy>,
    concernKeywordMap: basePolicy.concernKeywordMap,
    taskModeKeywordMap: basePolicy.taskModeKeywordMap,
    domainKeywordGroups: basePolicy.domainKeywordGroups,
    synonyms: basePolicy.synonyms,
  };
}

function mergeRecommendationHostPolicy(
  ...layers: Array<Partial<RecommendationHostPolicy>>
): RecommendationHostPolicy {
  const scalarPolicy = Object.assign({}, ...layers);

  return {
    ...scalarPolicy,
    maxPerAssetKind: {
      ...Object.assign(
        {},
        ...layers.map((layer) => layer.maxPerAssetKind ?? {}),
      ),
    },
    targetAssetKinds: mergeByStableKey(
      layers.flatMap((layer) => layer.targetAssetKinds ?? []),
      (entry) => entry.assetKind,
    ),
    targetConcerns: mergeByStableKey(
      layers.flatMap((layer) => layer.targetConcerns ?? []),
      (entry) => entry.concern,
    ),
    suppressedAssetIdPatterns: mergeUniqueStrings(
      ...layers.map((layer) => layer.suppressedAssetIdPatterns),
    ),
    suppressedCapabilityTerms: mergeUniqueStrings(
      ...layers.map((layer) => layer.suppressedCapabilityTerms),
    ),
    deprioritizedAssetIdPatterns: mergeOptionalUniqueStrings(
      ...layers.map((layer) => layer.deprioritizedAssetIdPatterns),
    ),
    deprioritizedCapabilityTerms: mergeOptionalUniqueStrings(
      ...layers.map((layer) => layer.deprioritizedCapabilityTerms),
    ),
  } as RecommendationHostPolicy;
}

function buildRecommendationHostPolicyFromPresets(
  host: RecommendationHost,
  presets: RecommendationPolicyPresets | undefined,
  presetRefs: RecommendationPolicyPresetRefs | undefined,
): Partial<RecommendationHostPolicy> {
  if (!presetRefs) {
    return {};
  }

  return {
    targetAssetKinds: resolveTargetAssetKindPresets(
      host,
      presets?.targetAssetKinds,
      presetRefs.targetAssetKinds,
    ),
    targetConcerns: resolveTargetConcernPresets(
      host,
      presets?.targetConcerns,
      presetRefs.targetConcerns,
    ),
  };
}

function resolveTargetAssetKindPresets(
  host: RecommendationHost,
  presetCatalog: RecommendationPolicyPresets["targetAssetKinds"],
  presetRefs: string[] | undefined,
): RecommendationTargetAssetKindPreference[] | undefined {
  if (!presetRefs || presetRefs.length === 0) {
    return undefined;
  }

  if (!presetCatalog) {
    throw new Error(
      `Recommendation policy for ${host} references targetAssetKinds presets, but no targetAssetKinds presets are defined.`,
    );
  }

  return mergeByStableKey(
    presetRefs.flatMap((presetName) => {
      const preset = presetCatalog[presetName];
      if (!preset) {
        throw new Error(
          `Recommendation policy for ${host} references missing targetAssetKinds preset ${presetName}.`,
        );
      }
      return preset;
    }),
    (entry) => entry.assetKind,
  );
}

function resolveTargetConcernPresets(
  host: RecommendationHost,
  presetCatalog: RecommendationPolicyPresets["targetConcerns"],
  presetRefs: string[] | undefined,
): RecommendationTargetConcernPreference[] | undefined {
  if (!presetRefs || presetRefs.length === 0) {
    return undefined;
  }

  if (!presetCatalog) {
    throw new Error(
      `Recommendation policy for ${host} references targetConcerns presets, but no targetConcerns presets are defined.`,
    );
  }

  return mergeByStableKey(
    presetRefs.flatMap((presetName) => {
      const preset = presetCatalog[presetName];
      if (!preset) {
        throw new Error(
          `Recommendation policy for ${host} references missing targetConcerns preset ${presetName}.`,
        );
      }
      return preset;
    }),
    (entry) => entry.concern,
  );
}

function mergeUniqueStrings(
  ...collections: Array<string[] | undefined>
): string[] {
  return [...new Set(collections.flatMap((collection) => collection ?? []))];
}

function mergeByStableKey<T>(
  items: T[],
  keySelector: (item: T) => string,
): T[] {
  const orderedKeys: string[] = [];
  const entryByKey = new Map<string, T>();

  for (const item of items) {
    const key = keySelector(item);
    if (!entryByKey.has(key)) {
      orderedKeys.push(key);
    }
    entryByKey.set(key, item);
  }

  return orderedKeys.map((key) => entryByKey.get(key) as T);
}

function mergeOptionalUniqueStrings(
  ...collections: Array<string[] | undefined>
): string[] | undefined {
  const merged = mergeUniqueStrings(...collections);
  return merged.length > 0 ? merged : undefined;
}

async function explainRecommendation(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const assetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedHostRaw = getOptionValue(args, "--host");

  if (!assetId) {
    throw new Error("recommend explain requires --asset <assetId>");
  }

  const report = await readJsonFile<RecommendationReport>(
    join(projectRoot, ...REPORT_FILE_PATH),
    assertRecommendationReport,
  );

  let requestedHost: RecommendationHost | undefined;
  if (requestedHostRaw !== undefined) {
    if (!isRecommendationHost(requestedHostRaw)) {
      throw new Error(
        `Invalid --host value: ${requestedHostRaw}. Must be one of: ${RECOMMENDATION_HOSTS.join(", ")}`,
      );
    }
    requestedHost = requestedHostRaw;
  }

  const hosts = requestedHost ? [requestedHost] : RECOMMENDATION_HOSTS;
  const lines: string[] = [];

  for (const host of hosts) {
    const entry = report.topByHost[host].find(
      (candidate) => candidate.assetId === assetId,
    );
    if (!entry) {
      continue;
    }

    lines.push(`Host: ${host}`);
    lines.push(`  rank: ${entry.rank}`);
    lines.push(`  score: ${entry.score}`);
    lines.push(`  asset kind: ${entry.assetKind ?? "unknown"}`);
    lines.push(`  source: ${entry.sourceId} (${entry.sourceFamily})`);
    lines.push(
      `  prompt weight: ${entry.estimatedPromptWeight} (${entry.contextSizeClass})`,
    );
    lines.push(`  coverage: ${entry.coverageTags.join(", ") || "none"}`);
    lines.push(`  task modes: ${entry.taskModes.join(", ") || "none"}`);
    lines.push(
      `  matched signals: ${formatMatchedSignals(entry.matchedSignals)}`,
    );
    lines.push(`  reasons: ${entry.reasons.join(", ")}`);
    lines.push(`  breakdown: ${formatScoreBreakdown(entry.scoreBreakdown)}`);
  }

  if (lines.length === 0) {
    console.log(
      `Asset ${assetId} is not present in the current recommendation report.`,
    );
    return;
  }

  console.log(lines.join("\n"));
}

async function evaluateRecommendationFixtures(
  projectRoot: string,
  args: string[],
): Promise<number> {
  const shouldWrite = args.includes("--write");
  const policy = await loadRecommendationPolicy(projectRoot);
  const fixtures = buildRecommendationFixtures();
  const results = fixtures.map((fixture) => evaluateFixture(fixture, policy));
  const evaluationResult: RecommendationEvaluationResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixtures: results,
  };

  if (shouldWrite) {
    await writeJsonFile(
      join(projectRoot, ...EVALUATION_FILE_PATH),
      evaluationResult,
    );
  }

  let hasFailures = false;
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.description}`,
    );
    for (const check of result.checks) {
      console.log(
        `  ${check.passed ? "-" : "x"} ${check.name}: ${check.details}`,
      );
    }
    if (!result.passed) {
      hasFailures = true;
    }
  }

  return hasFailures ? 1 : 0;
}

async function printRecommendationPolicy(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const requestedHost = getOptionValue(args, "--host");
  const pretty = !args.includes("--compact");
  const policy = await loadRecommendationPolicy(projectRoot);

  if (!requestedHost) {
    console.log(JSON.stringify(policy, null, pretty ? 2 : undefined));
    return;
  }

  if (!isRecommendationHost(requestedHost)) {
    throw new Error(
      `recommend policy:print requires --host to be one of: ${RECOMMENDATION_HOSTS.join(", ")}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        schemaVersion: policy.schemaVersion,
        host: requestedHost,
        scoring: policy.scoring,
        hostPolicy: policy.hosts[requestedHost],
        concernKeywordMap: policy.concernKeywordMap,
        taskModeKeywordMap: policy.taskModeKeywordMap,
        domainKeywordGroups: policy.domainKeywordGroups,
        synonyms: policy.synonyms,
      },
      null,
      pretty ? 2 : undefined,
    ),
  );
}

function evaluateFixture(
  fixture: RecommendationEvaluationFixture,
  policy: RecommendationPolicy,
): RecommendationEvaluationResult["fixtures"][number] {
  const report = buildRecommendationReport(
    fixture.catalogEntries,
    fixture.demandProfile,
    policy,
  );
  const checks = fixture.expectations.flatMap((expectation) =>
    evaluateExpectation(expectation, report),
  );

  return {
    id: fixture.id,
    description: fixture.description,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function evaluateExpectation(
  expectation: RecommendationEvaluationExpectation,
  report: RecommendationReport,
): RecommendationEvaluationCheck[] {
  const entries = report.topByHost[expectation.host] ?? [];
  const hostSummary = report.hostSummaries[expectation.host];
  const bundle = report.suggestedBundles.find(
    (entry) => entry.host === expectation.host,
  );
  const checks: RecommendationEvaluationCheck[] = [];

  checks.push({
    name: `${expectation.host}-bundle-budget`,
    passed: Boolean(
      bundle && bundle.estimatedPromptWeight <= hostSummary.activationBudget,
    ),
    details: bundle
      ? `bundle weight ${bundle.estimatedPromptWeight}/${hostSummary.activationBudget}`
      : "missing bundle",
  });

  for (const requiredAssetId of expectation.requiredAssetIds ?? []) {
    const present = entries.some((entry) => entry.assetId === requiredAssetId);
    checks.push({
      name: `${expectation.host}-requires-${requiredAssetId}`,
      passed: present,
      details: present ? "present" : `missing from ${expectation.host}`,
    });
  }

  for (const requiredKind of expectation.requiredAssetKinds ?? []) {
    const actualCount = entries.filter(
      (entry) => entry.assetKind === requiredKind.assetKind,
    ).length;
    checks.push({
      name: `${expectation.host}-kind-${requiredKind.assetKind}`,
      passed: actualCount >= requiredKind.minimum,
      details: `found ${actualCount}, required ${requiredKind.minimum}`,
    });
  }

  if (expectation.maxPerSourceFamily !== undefined) {
    const topSourceFamilyCount = Math.max(
      0,
      ...Object.values(hostSummary.bySourceFamily),
    );
    checks.push({
      name: `${expectation.host}-source-diversity`,
      passed: topSourceFamilyCount <= expectation.maxPerSourceFamily,
      details: `largest source family count ${topSourceFamilyCount}, expected <= ${expectation.maxPerSourceFamily}`,
    });
  }

  for (const concern of expectation.requiredConcerns ?? []) {
    const actualCount = hostSummary.byConcern[concern] ?? 0;
    checks.push({
      name: `${expectation.host}-concern-${concern}`,
      passed: actualCount > 0,
      details: actualCount > 0 ? `present ${actualCount} times` : "missing",
    });
  }

  for (const pair of expectation.rankedAbove ?? []) {
    const higherRank =
      entries.find((entry) => entry.assetId === pair.higherAssetId)?.rank ??
      null;
    const lowerRank =
      entries.find((entry) => entry.assetId === pair.lowerAssetId)?.rank ??
      null;
    const passed =
      higherRank !== null && lowerRank !== null && higherRank < lowerRank;
    checks.push({
      name: `${expectation.host}-rank-${pair.higherAssetId}-above-${pair.lowerAssetId}`,
      passed,
      details:
        higherRank === null || lowerRank === null
          ? `missing ranks higher=${higherRank ?? "absent"} lower=${lowerRank ?? "absent"}`
          : `higher rank ${higherRank}, lower rank ${lowerRank}`,
    });
  }

  return checks;
}

function formatMatchedSignals(matches: RecommendationSignalMatch[]): string {
  if (matches.length === 0) {
    return "none";
  }

  return matches
    .map(
      (match) =>
        `${match.signalType}:${match.term}(w=${match.weight},e=${match.evidenceCount})`,
    )
    .join(", ");
}

function formatScoreBreakdown(breakdown: RecommendationScoreBreakdown): string {
  return [
    `authority=${breakdown.authority}`,
    `compatibility=${breakdown.compatibility}`,
    `portfolioFit=${breakdown.portfolioFit}`,
    `trust=${breakdown.trust}`,
    `sourcePriority=${breakdown.sourcePriority}`,
    `demand=${breakdown.demand}`,
    `hostPreference=${breakdown.hostPreference}`,
    `coverage=${breakdown.coverage}`,
    `diversity=${breakdown.diversity}`,
    `freshness=${breakdown.freshness}`,
    `costPenalty=${breakdown.costPenalty}`,
    `riskPenalty=${breakdown.riskPenalty}`,
    `negativePenalty=${breakdown.negativePenalty}`,
    `redundancyPenalty=${breakdown.redundancyPenalty}`,
    `budgetPenalty=${breakdown.budgetPenalty}`,
    `total=${breakdown.total}`,
  ].join(", ");
}

function getOptionValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex === -1) {
    return undefined;
  }

  return args[flagIndex + 1];
}

function isRecommendationHost(value: string): value is RecommendationHost {
  return RECOMMENDATION_HOSTS.includes(value as RecommendationHost);
}

function printRecommendHelp(): void {
  console.log(`recommend commands:
  report    Recompute the recommendation report using the external policy
  explain   Explain why an asset ranked for a host
  evaluate  Run golden recommendation fixtures (use --write to persist results)
  policy:print  Print the merged effective policy (--host <host> to scope)`);
}
