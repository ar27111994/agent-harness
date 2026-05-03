import { isHostCompatibleWithRecommendationHost } from "../host-adapters/registry.js";
import {
  buildCandidateRecommendation,
  computeEntryPreselectionScore,
} from "./candidates.js";
import { countBy, countCoverageTags } from "./counts.js";
import type {
  AssetCatalogEntry,
  RecommendationEntry,
  RecommendationPolicy,
  RecommendationScoreBreakdown,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";
import type {
  CandidateRecommendation,
  DemandContext,
  DynamicScore,
} from "./model.js";

export function buildTopRecommendationsForHost(
  host: RecommendationHost,
  entries: AssetCatalogEntry[],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): RecommendationEntry[] {
  const scoredCandidates = entries
    .filter((entry) => isEntryCompatibleWithRecommendationHost(entry, host))
    .filter((entry) => entry.compatibilityMode !== "incompatible")
    .map((entry) => {
      const candidate = buildCandidateRecommendation(
        entry,
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
    policy,
    getHostPreselectionLimit(host, policy),
  )
    .map(({ candidate }) => candidate)
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
  policy: RecommendationPolicy,
  limit: number,
): Array<{ candidate: CandidateRecommendation; preselectionScore: number }> {
  const hostPolicy = policy.hosts[host];
  const preserved = new Map<
    string,
    { candidate: CandidateRecommendation; preselectionScore: number }
  >();

  for (const target of hostPolicy.targetAssetKinds) {
    if (target.minimum <= 0) {
      continue;
    }
    const match = scoredCandidates.find(
      (entry) => entry.candidate.entry.assetKind === target.assetKind,
    );
    if (match) {
      preserved.set(match.candidate.entry.id, match);
    }
  }

  for (const target of hostPolicy.targetConcerns) {
    if (target.minimum <= 0) {
      continue;
    }
    const match = scoredCandidates.find((entry) =>
      entry.candidate.coverageTags.includes(target.concern),
    );
    if (match) {
      preserved.set(match.candidate.entry.id, match);
    }
  }

  const selected = [...preserved.values()];
  for (const entry of scoredCandidates) {
    if (selected.length >= limit) {
      break;
    }
    if (!preserved.has(entry.candidate.entry.id)) {
      selected.push(entry);
    }
  }

  return selected.slice(0, limit).sort(compareScoredCandidates);
}

function computeCandidatePreselectionScore(
  candidate: CandidateRecommendation,
): number {
  return (
    computeEntryPreselectionScore(candidate.entry) +
    candidate.breakdown.total +
    candidate.coverageTags.length * 4 +
    candidate.matchedSignals.reduce((total, match) => total + match.weight, 0)
  );
}

function getHostPreselectionLimit(
  host: RecommendationHost,
  policy: RecommendationPolicy,
): number {
  return Math.max(250, policy.hosts[host].recommendationLimit * 3);
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
  );
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
