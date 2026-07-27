import { isHostCompatibleWithRecommendationHost } from "../host-adapters/registry.js";
import {
  COVERAGE_OVERLAP_CAP,
  COVERAGE_TAG_PRESELECTION_WEIGHT,
  DUPLICATE_GROUP_OVERLAP_MULTIPLIER,
  HIGH_COST_BUDGET_DIVISOR,
  HIGH_COST_PENALTY_DIVISOR,
  HOST_PRESELECTION_LIMIT_MULTIPLIER,
  HOST_PRESELECTION_MIN_LIMIT,
  MIN_BUDGET_PENALTY,
} from "./constants.js";
import {
  buildCandidateRecommendation,
  computeEntryPreselectionScore,
} from "./candidates.js";
import { shouldEnforceConcernTarget } from "./signals.js";

import type {
  AssetCatalogEntry,
  RecommendationEntry,
  RecommendationPolicy,
  RecommendationScoreBreakdown,
} from "../types.js";
import type { CandidateRecommendationBase } from "./model.js";
import type { RecommendationHost } from "./hosts.js";
import type {
  CandidateRecommendation,
  DemandContext,
  DynamicScore,
} from "./model.js";

/**
 * Builds top recommendations for host from the provided inputs.
 */
export function buildTopRecommendationsForHost(
  host: RecommendationHost,
  candidateBases: CandidateRecommendationBase[],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): RecommendationEntry[] {
  const scoredCandidates = candidateBases
    .filter((base) => isEntryCompatibleWithRecommendationHost(base.entry, host))
    .filter((base) => base.entry.compatibilityMode !== "incompatible")
    .map((base) => {
      const candidate = buildCandidateRecommendation(
        base,
        host,
        demandContext,
        policy,
      );

      return candidate
        ? {
            candidate,
            preselectionScore: computeCandidatePreselectionScore(candidate),
          }
        : null;
    })
    .filter(
      (
        candidate,
      ): candidate is {
        candidate: CandidateRecommendation;
        preselectionScore: number;
      } => candidate !== null,
    )
    .sort(compareScoredCandidates);
  const candidates = preserveRequiredCoverageCandidates(
    scoredCandidates,
    host,
    demandContext,
    policy,
    getHostPreselectionLimit(host, policy),
  )
    .map(({ candidate }) => candidate)
    .sort(
      (left, right) =>
        right.breakdown.total - left.breakdown.total ||
        left.entry.id.localeCompare(right.entry.id),
    );

  const selectedCandidates = selectCandidatesForHost(
    host,
    candidates,
    demandContext,
    policy,
  );

  return selectedCandidates.map((candidate, index) => {
    const classification = candidate.entry.evidence.classification;

    return {
      assetId: candidate.entry.id,
      host,
      rank: index + 1,
      score: candidate.breakdown.total,
      reasons: candidate.reasons,
      assetKind: candidate.entry.assetKind,
      ...(classification
        ? {
            classificationConfidence: classification.confidence,
            classificationConfidenceLevel: classification.level,
          }
        : {}),
      sourceId: candidate.entry.source.sourceId,
      sourceFamily: candidate.sourceFamily,
      availableLocally: candidate.availableLocally,
      recommendationBasis: candidate.recommendationBasis,
      contextSizeClass: candidate.entry.contextCost.sizeClass,
      estimatedPromptWeight: candidate.entry.contextCost.estimatedPromptWeight,
      duplicateGroup: candidate.duplicateGroup,
      selectionStage: "top-by-host",
      coverageTags: candidate.coverageTags,
      taskModes: candidate.taskModes,
      matchedSignals: candidate.matchedSignals,
      scoreBreakdown: candidate.breakdown,
    };
  });
}

function compareScoredCandidates(
  left: { candidate: CandidateRecommendation; preselectionScore: number },
  right: { candidate: CandidateRecommendation; preselectionScore: number },
): number {
  return (
    right.preselectionScore - left.preselectionScore ||
    left.candidate.entry.id.localeCompare(right.candidate.entry.id)
  );
}

function preserveRequiredCoverageCandidates(
  scoredCandidates: Array<{
    candidate: CandidateRecommendation;
    preselectionScore: number;
  }>,
  host: RecommendationHost,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
  limit: number,
): Array<{ candidate: CandidateRecommendation; preselectionScore: number }> {
  const hostPolicy = policy.hosts[host];
  const preserved = new Map<
    string,
    { candidate: CandidateRecommendation; preselectionScore: number }
  >();

  for (const target of hostPolicy.targetAssetKinds) {
    preserveMinimumCandidates(
      scoredCandidates,
      preserved,
      target.minimum,
      (entry) => entry.candidate.entry.assetKind === target.assetKind,
    );
  }

  for (const target of hostPolicy.targetConcerns) {
    if (!shouldEnforceConcernTarget(target.concern, demandContext, policy)) {
      continue;
    }

    preserveMinimumCandidates(
      scoredCandidates,
      preserved,
      target.minimum,
      (entry) => entry.candidate.coverageTags.includes(target.concern),
    );
  }

  const selected = [...preserved.values()];
  const effectiveLimit = Math.max(limit, preserved.size);
  for (const entry of scoredCandidates) {
    if (selected.length >= effectiveLimit) {
      break;
    }
    if (!preserved.has(entry.candidate.entry.id)) {
      selected.push(entry);
    }
  }

  return selected.slice(0, effectiveLimit).sort(compareScoredCandidates);
}

function preserveMinimumCandidates(
  scoredCandidates: Array<{
    candidate: CandidateRecommendation;
    preselectionScore: number;
  }>,
  preserved: Map<
    string,
    { candidate: CandidateRecommendation; preselectionScore: number }
  >,
  minimum: number,
  matchesTarget: (entry: {
    candidate: CandidateRecommendation;
    preselectionScore: number;
  }) => boolean,
): void {
  if (minimum <= 0) {
    return;
  }

  let preservedCount = [...preserved.values()].filter(matchesTarget).length;
  for (const entry of scoredCandidates) {
    if (preservedCount >= minimum) {
      return;
    }
    if (!matchesTarget(entry)) {
      continue;
    }
    if (!preserved.has(entry.candidate.entry.id)) {
      preserved.set(entry.candidate.entry.id, entry);
      preservedCount += 1;
    }
  }
}

function computeCandidatePreselectionScore(
  candidate: CandidateRecommendation,
): number {
  return (
    computeEntryPreselectionScore(candidate.entry) +
    candidate.breakdown.total +
    candidate.coverageTags.length * COVERAGE_TAG_PRESELECTION_WEIGHT +
    candidate.matchedSignals.reduce((total, match) => total + match.weight, 0)
  );
}

function getHostPreselectionLimit(
  host: RecommendationHost,
  policy: RecommendationPolicy,
): number {
  return Math.max(
    HOST_PRESELECTION_MIN_LIMIT,
    policy.hosts[host].recommendationLimit * HOST_PRESELECTION_LIMIT_MULTIPLIER,
  );
}

/**
 * Delegates host compatibility checks to the adapter registry so lifecycle-host
 * reuse and capability exclusions stay centralized.
 */
function isEntryCompatibleWithRecommendationHost(
  entry: AssetCatalogEntry,
  host: RecommendationHost,
): boolean {
  return isHostCompatibleWithRecommendationHost(
    entry.hosts,
    host,
    entry.assetKind,
    entry.compatibleHosts,
  );
}

function selectCandidatesForHost(
  host: RecommendationHost,
  candidates: CandidateRecommendation[],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): CandidateRecommendation[] {
  const hostPolicy = policy.hosts[host];
  const selectionState = createSelectionState();
  const remaining = [...candidates];

  while (
    selectionState.selected.length < hostPolicy.recommendationLimit &&
    remaining.length > 0
  ) {
    let bestIndex = -1;
    let bestScore: DynamicScore | null = null;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (exceedsHostCaps(candidate, selectionState, hostPolicy)) {
        continue;
      }

      const candidateScore = scoreCandidateAgainstSelection(
        candidate,
        selectionState,
        hostPolicy,
        demandContext,
        policy,
      );
      if (!bestScore) {
        bestIndex = index;
        bestScore = candidateScore;
        continue;
      }

      if (
        compareDynamicScores(
          candidateScore,
          bestScore,
          candidate,
          remaining[bestIndex] as CandidateRecommendation,
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
    addCandidateToSelectionState(
      selectionState,
      applyDynamicScore(chosenCandidate, bestScore),
    );
  }

  return selectionState.selected;
}

function scoreCandidateAgainstSelection(
  candidate: CandidateRecommendation,
  selectionState: SelectionState,
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): DynamicScore {
  const coverage = computeCoverageGain(
    candidate,
    selectionState,
    hostPolicy,
    demandContext,
    policy,
  );
  const diversity =
    (selectionState.sourceFamilyCounts[candidate.sourceFamily] ?? 0) > 0
      ? 0
      : policy.scoring.sourceDiversityBonus;
  const redundancyPenalty = computeRedundancyPenalty(
    candidate,
    selectionState,
    hostPolicy,
    policy,
  );
  const budgetPenalty =
    candidate.entry.contextCost.estimatedPromptWeight >
    hostPolicy.activationBudget / HIGH_COST_BUDGET_DIVISOR
      ? Math.max(
          MIN_BUDGET_PENALTY,
          Math.round(
            candidate.entry.contextCost.estimatedPromptWeight /
              HIGH_COST_PENALTY_DIVISOR,
          ),
        )
      : 0;

  return {
    total:
      candidate.breakdown.total +
      coverage +
      diversity -
      redundancyPenalty -
      budgetPenalty,
    coverage,
    diversity,
    redundancyPenalty,
    budgetPenalty,
  };
}

function computeCoverageGain(
  candidate: CandidateRecommendation,
  selectionState: SelectionState,
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): number {
  let score = 0;

  for (const target of hostPolicy.targetAssetKinds) {
    if (
      target.assetKind === candidate.entry.assetKind &&
      (selectionState.kindCounts[target.assetKind] ?? 0) < target.minimum
    ) {
      score += target.weight * policy.scoring.coverageGainWeight;
    }
  }

  for (const target of hostPolicy.targetConcerns) {
    if (!shouldEnforceConcernTarget(target.concern, demandContext, policy)) {
      continue;
    }

    if (
      candidate.coverageTags.includes(target.concern) &&
      (selectionState.coverageTagCounts[target.concern] ?? 0) < target.minimum
    ) {
      score += target.weight * policy.scoring.coverageGainWeight;
    }
  }

  return score;
}

function computeRedundancyPenalty(
  candidate: CandidateRecommendation,
  selectionState: SelectionState,
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
  policy: RecommendationPolicy,
): number {
  const sameSourceFamilyCount =
    selectionState.sourceFamilyCounts[candidate.sourceFamily] ?? 0;
  const duplicateGroupOverlap = candidate.duplicateGroup
    ? (selectionState.duplicateGroupCounts[candidate.duplicateGroup] ?? 0) *
      DUPLICATE_GROUP_OVERLAP_MULTIPLIER
    : 0;
  const coverageOverlap = computeIndexedCoverageOverlap(
    candidate,
    selectionState,
  );
  const overlapCount =
    sameSourceFamilyCount + duplicateGroupOverlap + coverageOverlap;
  const basePenalty = overlapCount * policy.scoring.overlapPenalty;
  const sourceSaturationPenalty = computeSourceSaturationPenalty(
    sameSourceFamilyCount,
    hostPolicy,
  );

  return basePenalty + sourceSaturationPenalty;
}

function computeIndexedCoverageOverlap(
  candidate: CandidateRecommendation,
  selectionState: SelectionState,
): number {
  let overlapCount = 0;

  for (const tag of candidate.coverageTags) {
    overlapCount += Math.min(
      COVERAGE_OVERLAP_CAP,
      selectionState.coverageTagCounts[tag] ?? 0,
    );
  }

  return overlapCount;
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
  selectionState: SelectionState,
  hostPolicy: RecommendationPolicy["hosts"][RecommendationHost],
): boolean {
  const assetKindCap = hostPolicy.maxPerAssetKind[candidate.entry.assetKind];
  if (
    assetKindCap !== undefined &&
    (selectionState.kindCounts[candidate.entry.assetKind] ?? 0) >= assetKindCap
  ) {
    return true;
  }

  if (
    (selectionState.sourceFamilyCounts[candidate.sourceFamily] ?? 0) >=
    hostPolicy.maxPerSourceFamily
  ) {
    return true;
  }

  if (
    candidate.duplicateGroup &&
    (selectionState.duplicateGroupCounts[candidate.duplicateGroup] ?? 0) >=
      hostPolicy.maxPerDuplicateGroup
  ) {
    return true;
  }

  return false;
}

interface SelectionState {
  selected: CandidateRecommendation[];
  kindCounts: Record<string, number>;
  sourceFamilyCounts: Record<string, number>;
  duplicateGroupCounts: Record<string, number>;
  coverageTagCounts: Record<string, number>;
}

function createSelectionState(): SelectionState {
  return {
    selected: [],
    kindCounts: {},
    sourceFamilyCounts: {},
    duplicateGroupCounts: {},
    coverageTagCounts: {},
  };
}

function addCandidateToSelectionState(
  selectionState: SelectionState,
  candidate: CandidateRecommendation,
): void {
  selectionState.selected.push(candidate);
  incrementCount(selectionState.kindCounts, candidate.entry.assetKind);
  incrementCount(selectionState.sourceFamilyCounts, candidate.sourceFamily);
  if (candidate.duplicateGroup) {
    incrementCount(
      selectionState.duplicateGroupCounts,
      candidate.duplicateGroup,
    );
  }
  for (const coverageTag of candidate.coverageTags) {
    incrementCount(selectionState.coverageTagCounts, coverageTag);
  }
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
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
  // Only tag as "coverage-gap-fill" when coverage meaningfully contributes
  // to the total score. Without this threshold, every candidate with even a
  // trivial coverage bonus gets tagged, causing false broad-fallback detection
  // in recommend evaluate (e.g. cursor host showing 1 broad fallback top
  // across 23 hosts when the real fit signal is exact-stack or ecosystem).
  // Threshold: coverage must contribute ≥10% of the total score.
  if (score.coverage > 0 && score.coverage >= score.total * 0.1) {
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
  rightCandidate: CandidateRecommendation,
): number {
  if (left.total !== right.total) {
    return right.total - left.total;
  }

  if (
    leftCandidate.entry.contextCost.estimatedPromptWeight !==
    rightCandidate.entry.contextCost.estimatedPromptWeight
  ) {
    return (
      leftCandidate.entry.contextCost.estimatedPromptWeight -
      rightCandidate.entry.contextCost.estimatedPromptWeight
    );
  }

  return leftCandidate.entry.id.localeCompare(rightCandidate.entry.id);
}
