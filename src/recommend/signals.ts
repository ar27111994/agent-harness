import { hasDesignSystemSignals } from "../domains/discovery/demand-helpers.js";
import { extractPackageManifestEntry } from "../lib/package-manifest-entry.js";
import { replaceRunsWithDash, trimDashes } from "../lib/safe-paths.js";
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
 * Tokens that carry no package identity: they appear in package names of
 * every ecosystem (node-api, @scope/js, -cli, -core, …) and therefore cannot
 * distinguish a declared dependency from a coincidental token in an
 * unrelated asset (#444). Kept deliberately small and ecosystem-neutral.
 */
const PACKAGE_IDENTITY_STOPWORD_TOKENS = new Set([
  "api",
  "cli",
  "core",
  "extension",
  "extensions",
  "js",
  "kit",
  "lib",
  "libs",
  "node",
  "plugin",
  "plugins",
  "sdk",
  "tool",
  "tools",
  "ts",
  "ui",
  "util",
  "utils",
]);

/**
 * Computes the distinctive identity tokens of a package-manifest entry
 * (`npm:@scope/name`, `pypi:pkg`, …): the scope name plus the bare package
 * name's tokens, minus generic package-noise tokens. Returns undefined for
 * values that are not package entries. `@duckdb/node-api` → {duckdb},
 * `npm:c8` → {c8}, `pypi:duckdb` → {duckdb}.
 */
function buildPackageIdentityTokens(
  value: string,
): ReadonlySet<string> | undefined {
  const manifestEntry = extractPackageManifestEntry(value);
  if (manifestEntry === null) {
    return undefined;
  }
  const identityTokens = new Set<string>();
  for (const token of manifestEntry
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((part) => part.length > 1)) {
    if (!PACKAGE_IDENTITY_STOPWORD_TOKENS.has(token)) {
      identityTokens.add(token);
    }
  }
  return identityTokens.size === 0 ? undefined : identityTokens;
}

/**
 * Collects matched signals from the provided inputs.
 *
 * @param assetTermStrength - Optional per-asset provenance map (term →
 *   strength class of the asset content that produced it). When provided,
 *   the reported evidence fields describe evidence ABOUT THE ASSET (how many
 *   of the asset's own terms hit the demand term, and their provenance
 *   strength) instead of the workspace's demand-side evidence (#444). The
 *   match weight still reflects demand intensity.
 */
export function collectMatchedSignals(
  searchTerms: Set<string>,
  demandContext: DemandContext,
  policy: RecommendationPolicy,
  assetTermStrength?: ReadonlyMap<string, DemandEvidenceStrength>,
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
      const assetEvidence = computeAssetSideEvidence(
        searchTerms,
        term.matchTerms,
        assetTermStrength,
      );

      return {
        term: term.canonicalTerm,
        signalType: term.signalType,
        weight: Math.max(1, Math.round(baseWeight * termMultiplier)),
        evidenceCount: assetEvidence.evidenceCount,
        weightedEvidenceCount: assetEvidence.weightedEvidenceCount,
        evidenceStrengthCounts: assetEvidence.evidenceStrengthCounts,
      };
    })
    .sort(
      (left, right) =>
        right.weight - left.weight || left.term.localeCompare(right.term),
    );
}

/**
 * Computes the asset-side evidence record for one demand-term match:
 * how many of the asset's own search terms hit the demand term, and the
 * provenance-strength histogram of those hits (#444). Without a provenance
 * map the histogram is left undefined and evidenceCount is the raw hit
 * count — both are asset-side facts, never workspace evidence.
 */
function computeAssetSideEvidence(
  searchTerms: Set<string>,
  matchTerms: ReadonlySet<string>,
  assetTermStrength: ReadonlyMap<string, DemandEvidenceStrength> | undefined,
): {
  evidenceCount: number;
  weightedEvidenceCount?: number;
  evidenceStrengthCounts?: Record<DemandEvidenceStrength, number>;
} {
  const hitTerms: string[] = [];
  for (const term of searchTerms) {
    if (matchTerms.has(term)) {
      hitTerms.push(term);
    }
  }
  if (assetTermStrength === undefined || hitTerms.length === 0) {
    return {
      evidenceCount: hitTerms.length,
      weightedEvidenceCount: undefined,
      evidenceStrengthCounts: undefined,
    };
  }

  const counts: Record<DemandEvidenceStrength, number> = {
    strong: 0,
    medium: 0,
    weak: 0,
  };
  for (const term of hitTerms) {
    const strength = assetTermStrength.get(term);
    if (strength === undefined) {
      counts.weak += 1;
    } else {
      counts[strength] += 1;
    }
  }
  return {
    evidenceCount: hitTerms.length,
    weightedEvidenceCount: computeWeightedEvidenceCount(counts),
    evidenceStrengthCounts: counts,
  };
}

/**
 * Builds demand context from the provided inputs.
 * Accepts one or more session intents; multiple intents are merged additively.
 */
export function buildDemandContext(
  demandProfile: DemandProfile | null,
  policy: RecommendationPolicy,
  sessionIntents: SessionIntent | readonly SessionIntent[] = "general",
): DemandContext {
  const resolvedIntents: readonly SessionIntent[] = Array.isArray(
    sessionIntents,
  )
    ? (sessionIntents as readonly SessionIntent[])
    : [sessionIntents as SessionIntent];
  const demandTermMap = new Map<string, DemandTermContext>();
  const packageIdentityByTerm = new Map<string, ReadonlySet<string>>();
  const synonymLookup = buildSynonymLookup(policy);

  const registerTerm = (
    signalType: RecommendationSignalType,
    rawTerm: string,
    evidenceStrength: DemandEvidenceStrength,
  ): void => {
    const canonicalTerm = canonicalizePhrase(rawTerm, policy, synonymLookup);
    const key = `${signalType}:${canonicalTerm}`;
    const matchTerms = buildSearchTerms([rawTerm], policy, synonymLookup);
    const packageIdentityTokens = buildPackageIdentityTokens(rawTerm);
    if (packageIdentityTokens !== undefined) {
      packageIdentityByTerm.set(canonicalTerm, packageIdentityTokens);
    }
    const existing = demandTermMap.get(key);

    if (existing) {
      existing.evidenceCount += 1;
      existing.evidenceStrengthCounts[evidenceStrength] += 1;
      for (const matchTerm of matchTerms) {
        existing.matchTerms.add(matchTerm);
      }
      if (
        packageIdentityTokens !== undefined &&
        existing.packageIdentityTokens === undefined
      ) {
        existing.packageIdentityTokens = packageIdentityTokens;
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
      packageIdentityTokens,
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
  for (const intent of resolvedIntents) {
    registerSessionIntentTerms(intent, registerTerm);
  }

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
    packageIdentityByTerm,
    demandKeywords: buildDemandKeywordSet(
      demandProfile,
      policy,
      resolvedIntents,
    ),
    packageManagers: demandProfile
      ? new Set(
          demandProfile.evidence.flatMap((ev) =>
            ev.matchedSignals.packageManagers.map((pm) => pm.toLowerCase()),
          ),
        )
      : new Set<string>(),
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
  sessionIntents: readonly SessionIntent[],
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

  for (const intent of sessionIntents) {
    for (const keyword of getSessionIntentKeywords(intent)) {
      keywords.add(keyword);
    }
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
 * Computes out-of-domain penalty for an entry.
 * Accepts precomputed domainGroupTermSets to avoid rebuilding per-candidate.
 */
export function computeOutOfDomainPenalty(
  searchTerms: Set<string>,
  demandContext: DemandContext,
  domainGroupTermSets: Map<string, Set<string>>,
  outOfDomainGroupPenalty: number,
): number {
  let penalty = 0;

  for (const [group, groupTerms] of domainGroupTermSets) {
    if (!intersects(searchTerms, groupTerms)) {
      continue;
    }
    if (demandContext.activeDomainGroups.has(group)) {
      continue;
    }

    penalty += outOfDomainGroupPenalty;
  }

  return penalty;
}

/**
 * Builds coverage tags from the provided inputs.
 * Accepts precomputed concernTermSets to avoid rebuilding per-candidate.
 */
export function buildCoverageTags(
  searchTerms: Set<string>,
  matchedSignals: RecommendationSignalMatch[],
  concernTermSets: Map<string, Set<string>>,
): string[] {
  const tags = new Set<string>();

  for (const [concern, terms] of concernTermSets) {
    if (intersects(searchTerms, terms)) {
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
 * Accepts precomputed taskModeTermSets to avoid rebuilding per-candidate.
 */
export function buildTaskModes(
  searchTerms: Set<string>,
  coverageTags: string[],
  matchedSignals: RecommendationSignalMatch[],
  taskModeTermSets: Map<string, Set<string>>,
  contextCost: AssetContextCost,
): string[] {
  const modes = new Set<string>();

  for (const [mode, terms] of taskModeTermSets) {
    if (intersects(searchTerms, terms)) {
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
 * Builds a flat alias→canonical lookup map from a policy's synonym table.
 *
 * Building this once per scoring run and passing it to `buildSearchTerms` /
 * `canonicalizePhrase` reduces synonym canonicalization from O(tokens × synonyms)
 * to O(tokens) — a significant win when scoring thousands of catalog entries.
 *
 * @param policy - The recommendation policy whose synonyms table to index.
 * @returns A map from each normalised alias (and each normalised canonical key
 *   itself) to its normalised canonical form.
 */
export function buildSynonymLookup(
  policy: RecommendationPolicy,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(policy.synonyms)) {
    const normalizedCanonical = normalizePhrase(canonical);
    // The canonical key is itself a valid lookup target.
    lookup.set(normalizedCanonical, normalizedCanonical);
    for (const alias of aliases) {
      lookup.set(normalizePhrase(alias), normalizedCanonical);
    }
  }
  return lookup;
}

/**
 * Builds search terms from the provided inputs.
 *
 * @param values - Raw term values to normalise and canonicalise.
 * @param policy - The active recommendation policy.
 * @param synonymLookup - Optional precomputed alias→canonical map built by
 *   `buildSynonymLookup`. Pass this when calling in a hot loop to avoid
 *   rebuilding it on every invocation.
 */
export function buildSearchTerms(
  values: string[],
  policy: RecommendationPolicy,
  synonymLookup?: Map<string, string>,
): Set<string> {
  const searchTerms = new Set<string>();

  for (const value of values) {
    const normalizedPhrase = canonicalizePhrase(value, policy, synonymLookup);
    if (normalizedPhrase) {
      searchTerms.add(normalizedPhrase);
    }

    for (const token of value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((part) => part.length > 1)) {
      searchTerms.add(canonicalizePhrase(token, policy, synonymLookup));
    }
  }

  return searchTerms;
}

/**
 * Canonicalises a phrase against the policy synonym table.
 *
 * When `synonymLookup` is provided the lookup is O(1); when omitted a fresh
 * O(synonyms) scan is performed for backward-compatibility.
 *
 * @param value - The raw phrase to canonicalise.
 * @param policy - The active recommendation policy.
 * @param synonymLookup - Optional precomputed map from `buildSynonymLookup`.
 */
function canonicalizePhrase(
  value: string,
  policy: RecommendationPolicy,
  synonymLookup?: Map<string, string>,
): string {
  const normalizedValue = normalizePhrase(value);

  if (synonymLookup !== undefined) {
    return synonymLookup.get(normalizedValue) ?? normalizedValue;
  }

  // Fallback: linear scan (used when no precomputed map is available).
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
 * Memoized normalized phrase cache. `normalizePhrase` is pure and
 * idempotent, but the ranking/selection loops re-normalize the same terms
 * thousands of times per host (each call runs three regex passes). Caching
 * turns those hits into Map lookups — a measured 79% of recommend wall time
 * was phrase canonicalization. Bounded: distinct phrases in a run are a
 * few thousand at most; the cache is cleared when it passes the cap so a
 * pathological workload cannot grow it without bound.
 */
const NORMALIZE_PHRASE_CACHE_MAX_ENTRIES = 20_000;
const normalizePhraseCache = new Map<string, string>();

/**
 * Returns whether the character is safe to keep verbatim in a normalized
 * demand phrase.
 */
function isPhraseCharacter(character: string): boolean {
  return /[a-z0-9]/u.test(character);
}

/**
 * Provides normalize phrase for the lifecycle pipeline.
 */
export function normalizePhrase(value: string): string {
  const cached = normalizePhraseCache.get(value);
  if (cached !== undefined) {
    return cached;
  }

  // Linear run-collapse + dash trim (no regex backtracking on the phrase).
  const normalized = trimDashes(
    replaceRunsWithDash(value.toLowerCase(), isPhraseCharacter),
  ).trim();

  if (normalizePhraseCache.size >= NORMALIZE_PHRASE_CACHE_MAX_ENTRIES) {
    normalizePhraseCache.clear();
  }
  normalizePhraseCache.set(value, normalized);
  return normalized;
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
