import { hasDesignSystemSignals } from "../domains/discovery/demand-helpers.js";
import { extractPackageManifestEntry } from "../lib/package-manifest-entry.js";
import {
  getSessionIntentConcernTerms,
  getSessionIntentKeywords,
} from "../lib/session-intent.js";
import type {
  AssetContextCost,
  AssetKind,
  DemandEvidenceStrength,
  DemandProfile,
  RecommendationPolicy,
  RecommendationSignalMatch,
  RecommendationSignalType,
  SessionIntent,
} from "../types.js";
import type { DemandContext, DemandTermContext } from "./model.js";

/**
 * Collects matched signals from the provided inputs.
 */
export function collectMatchedSignals(
  searchTerms: Set<string>,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): RecommendationSignalMatch[] {
  return demandContext.terms
    .filter((term) => intersects(searchTerms, term.matchTerms))
    .map((term) => {
      const weightedEvidenceCount = computeWeightedEvidenceCount(
        term.evidenceStrengthCounts,
      );
      const baseWeight =
        policy.scoring.demandSignalWeights[term.signalType] *
        weightedEvidenceCount;
      const termMultiplier =
        policy.scoring.demandTermMultipliers[term.canonicalTerm] ?? 1;

      return {
        term: term.canonicalTerm,
        signalType: term.signalType,
        weight: Math.max(1, Math.round(baseWeight * termMultiplier)),
        evidenceCount: term.evidenceCount,
        weightedEvidenceCount,
        evidenceStrengthCounts: { ...term.evidenceStrengthCounts },
      };
    })
    .sort(
      (left, right) =>
        right.weight - left.weight || left.term.localeCompare(right.term),
    );
}

/**
 * Builds demand context from the provided inputs.
 */
export function buildDemandContext(
  demandProfile: DemandProfile | null,
  policy: RecommendationPolicy,
  sessionIntent: SessionIntent = "general",
): DemandContext {
  const demandTermMap = new Map<string, DemandTermContext>();

  const registerTerm = (
    signalType: RecommendationSignalType,
    rawTerm: string,
    evidenceStrength: DemandEvidenceStrength,
  ): void => {
    const canonicalTerm = canonicalizePhrase(rawTerm, policy);
    const key = `${signalType}:${canonicalTerm}`;
    const matchTerms = buildSearchTerms([rawTerm], policy);
    const existing = demandTermMap.get(key);

    if (existing) {
      existing.evidenceCount += 1;
      existing.evidenceStrengthCounts[evidenceStrength] += 1;
      for (const matchTerm of matchTerms) {
        existing.matchTerms.add(matchTerm);
      }
      return;
    }

    demandTermMap.set(key, {
      key,
      canonicalTerm,
      signalType,
      evidenceCount: 1,
      evidenceStrengthCounts:
        createEmptyEvidenceStrengthCounts(evidenceStrength),
      matchTerms,
    });
  };

  if (demandProfile) {
    for (const evidence of demandProfile.evidence) {
      for (const signalType of recommendationSignalTypes()) {
        for (const rawTerm of evidence.matchedSignals[signalType]) {
          registerTerm(
            signalType,
            rawTerm,
            evidence.evidenceStrength ?? "medium",
          );
        }
      }
    }

    registerBridgeDemandTerms(demandProfile, registerTerm);
  }
  registerSessionIntentTerms(sessionIntent, registerTerm);

  const terms = [...demandTermMap.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  return {
    terms,
    hasSignals: demandTermMap.size > 0,
    activeDomainGroups: buildActiveDomainGroups(terms, policy),
    packageManifestEntries: demandProfile
      ? buildPackageManifestEntrySet(demandProfile)
      : new Set<string>(),
    demandKeywords: buildDemandKeywordSet(demandProfile, policy, sessionIntent),
  };
}

/**
 * Determines whether a host concern target has medium/strong supporting demand
 * evidence after canonicalizing the requested concern through policy synonyms.
 */
export function shouldEnforceConcernTarget(
  concern: string,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): boolean {
  const canonicalConcern = canonicalizePhrase(concern, policy);

  return demandContext.terms.some(
    (term) =>
      term.signalType === "concerns" &&
      term.canonicalTerm === canonicalConcern &&
      (term.evidenceStrengthCounts.strong > 0 ||
        term.evidenceStrengthCounts.medium > 0),
  );
}

function registerBridgeDemandTerms(
  demandProfile: DemandProfile,
  registerTerm: (
    signalType: RecommendationSignalType,
    rawTerm: string,
    evidenceStrength: DemandEvidenceStrength,
  ) => void,
): void {
  if (hasDesignSystemSignals(demandProfile)) {
    registerTerm("tooling", "penpot", "strong");
  }
}

function buildPackageManifestEntrySet(
  demandProfile: DemandProfile,
): Set<string> {
  return new Set(
    demandProfile.signals.tooling
      .map((tooling) => normalizePackageManifestEntry(tooling))
      .filter((entry): entry is string => entry !== null),
  );
}

function registerSessionIntentTerms(
  sessionIntent: SessionIntent,
  registerTerm: (
    signalType: RecommendationSignalType,
    rawTerm: string,
    evidenceStrength: DemandEvidenceStrength,
  ) => void,
): void {
  for (const concern of getSessionIntentConcernTerms(sessionIntent)) {
    registerTerm("concerns", concern, "strong");
  }
}

function buildDemandKeywordSet(
  demandProfile: DemandProfile | null,
  policy: RecommendationPolicy,
  sessionIntent: SessionIntent,
): Set<string> {
  const keywords = new Set<string>();

  if (demandProfile) {
    for (const signalType of recommendationSignalTypes()) {
      for (const rawTerm of demandProfile.signals[signalType]) {
        keywords.add(normalizePhrase(rawTerm));
        for (const token of rawTerm
          .toLowerCase()
          .split(/[^a-z0-9]+/u)
          .filter((part) => part.length > 1)) {
          keywords.add(normalizePhrase(token));
        }
        for (const matchTerm of buildSearchTerms([rawTerm], policy)) {
          keywords.add(matchTerm);
        }
      }
    }

    if (hasDesignSystemSignals(demandProfile)) {
      keywords.add("penpot");
    }
  }

  for (const keyword of getSessionIntentKeywords(sessionIntent)) {
    keywords.add(keyword);
  }

  return keywords;
}

function normalizePackageManifestEntry(value: string): string | null {
  const manifestEntry = extractPackageManifestEntry(value);
  return manifestEntry ? normalizePhrase(manifestEntry) : null;
}

/**
 * Creates an empty evidence-strength histogram for one demand term.
 */
function createEmptyEvidenceStrengthCounts(
  initialStrength?: DemandEvidenceStrength,
): Record<DemandEvidenceStrength, number> {
  return {
    strong: initialStrength === "strong" ? 1 : 0,
    medium: initialStrength === "medium" ? 1 : 0,
    weak: initialStrength === "weak" ? 1 : 0,
  };
}

/**
 * Collapses evidence-strength counts into a capped weighting bucket.
 */
function computeWeightedEvidenceCount(
  evidenceStrengthCounts: Record<DemandEvidenceStrength, number>,
): number {
  if (evidenceStrengthCounts.strong > 0) {
    return 3;
  }

  if (evidenceStrengthCounts.medium > 0) {
    return Math.min(3, 1 + evidenceStrengthCounts.medium);
  }

  if (evidenceStrengthCounts.weak > 0) {
    return 1;
  }

  return 0;
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

/**
 * Provides compute out of domain penalty for the lifecycle pipeline.
 */
export function computeOutOfDomainPenalty(
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

/**
 * Builds coverage tags from the provided inputs.
 */
export function buildCoverageTags(
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

/**
 * Builds task modes from the provided inputs.
 */
export function buildTaskModes(
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

/**
 * Builds duplicate group from the provided inputs.
 */
export function buildDuplicateGroup(
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

/**
 * Builds search terms from the provided inputs.
 */
export function buildSearchTerms(
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

/**
 * Provides normalize phrase for the lifecycle pipeline.
 */
export function normalizePhrase(value: string): string {
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
