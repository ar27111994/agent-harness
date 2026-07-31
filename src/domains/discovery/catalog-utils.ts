import type {
  AssetCatalogEntry,
  AssetContextCost,
  AssetRisk,
  AssetStatus,
  CompatibilityMode,
  DemandProfile,
  HostTarget,
  SelectionRegistry,
  SourceDefinition,
} from "../../types.js";

/**
 * Provides count by for the lifecycle pipeline.
 */
export function countBy<T>(
  items: T[],
  getKey: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

/**
 * Defines generic capability tokens shared by the lifecycle pipeline.
 */
export const GENERIC_CAPABILITY_TOKENS = new Set([
  "agent",
  "agents",
  "context",
  "core",
  "files",
  "md",
  "opencode",
  "plugin",
  "plugins",
  "skill",
  "skills",
  "subagents",
]);

const GENERIC_DISPLAY_NAME_SEGMENTS = new Set([
  "agent",
  "agents",
  "agents-md",
  "copilot-instructions",
  "index",
  "instructions",
  "readme",
  "skill",
  "skill-md",
  "skills",
]);

/**
 * Builds risk from the provided inputs.
 */
export function buildRisk(
  hasHooks: boolean,
  hasExecScripts: boolean,
  requiresNetwork: boolean,
): AssetRisk {
  const enabledRiskFlags = [hasHooks, hasExecScripts, requiresNetwork].filter(
    Boolean,
  ).length;

  if (enabledRiskFlags >= 2) {
    return {
      level: "high",
      hasHooks,
      hasExecScripts,
      requiresNetwork,
    };
  }

  if (hasHooks || hasExecScripts || requiresNetwork) {
    return {
      level: "medium",
      hasHooks,
      hasExecScripts,
      requiresNetwork,
    };
  }

  return {
    level: "low",
    hasHooks,
    hasExecScripts,
    requiresNetwork,
  };
}

/**
 * Provides classify context cost for the lifecycle pipeline.
 */
export function classifyContextCost(lineCount: number): AssetContextCost {
  if (lineCount <= 40) {
    return { sizeClass: "tiny", estimatedPromptWeight: 1 };
  }

  if (lineCount <= 160) {
    return { sizeClass: "small", estimatedPromptWeight: 2 };
  }

  if (lineCount <= 400) {
    return { sizeClass: "medium", estimatedPromptWeight: 4 };
  }

  return { sizeClass: "large", estimatedPromptWeight: 8 };
}

/**
 * Provides compute portfolio fit for the lifecycle pipeline.
 */
export function computePortfolioFit(
  capabilities: string[],
  demandProfile: DemandProfile | null,
): number {
  if (!demandProfile) {
    return 0;
  }

  const demandTerms = new Set<string>(
    [
      ...demandProfile.signals.languages,
      ...demandProfile.signals.packageManagers,
      ...demandProfile.signals.frameworks,
      ...demandProfile.signals.concerns,
      ...demandProfile.signals.tooling,
    ].flatMap((value) => splitIntoKeywords(value)),
  );

  if (demandTerms.size === 0) {
    return 0;
  }

  const capabilityTerms = new Set<string>(
    capabilities.flatMap((value) => splitIntoKeywords(value)),
  );
  let matchCount = 0;

  for (const demandTerm of demandTerms) {
    if (capabilityTerms.has(demandTerm)) {
      matchCount += 1;
    }
  }

  if (matchCount === 0) {
    return 0;
  }

  return Number(Math.min(1, matchCount / demandTerms.size).toFixed(2));
}

/**
 * Provides compute host fit for the lifecycle pipeline.
 */
export function computeHostFit(
  hosts: HostTarget[],
  compatibilityMode: CompatibilityMode,
): number {
  if (compatibilityMode === "native") {
    return hosts.length > 1 ? 1 : 0.95;
  }

  if (compatibilityMode === "adaptable") {
    return 0.7;
  }

  if (compatibilityMode === "partial") {
    return 0.45;
  }

  if (compatibilityMode === "reference-only") {
    return 0.2;
  }

  return 0;
}

/**
 * Provides find duplicate group for the lifecycle pipeline.
 */
export function findDuplicateGroup(
  capabilities: string[],
  selectionRegistry: SelectionRegistry,
): string | undefined {
  const capabilitySet = new Set(
    capabilities.flatMap((capability) => splitIntoKeywords(capability)),
  );

  for (const duplicateGroup of selectionRegistry.duplicateGroups) {
    const duplicateTokens = splitIntoKeywords(duplicateGroup.capability);
    if (duplicateTokens.every((token) => capabilitySet.has(token))) {
      return duplicateGroup.id;
    }
  }

  return undefined;
}

/**
 * Builds candidate rank hint from the provided inputs.
 */
export function buildCandidateRankHint(authorityTier: string): string {
  if (
    authorityTier === "official-first-party" ||
    authorityTier === "official-marketplace"
  ) {
    return "preferred-official";
  }

  if (authorityTier === "trusted-local") {
    return "preferred-local";
  }

  if (authorityTier === "trusted-community") {
    return "candidate-community";
  }

  return "candidate-catalog";
}

/**
 * Provides merge remote catalog entries for the lifecycle pipeline.
 */
export function mergeRemoteCatalogEntries(
  existingEntries: AssetCatalogEntry[],
  newEntries: AssetCatalogEntry[],
  refreshedSourceIds: Set<string>,
): AssetCatalogEntry[] {
  const retainedEntries = existingEntries.filter(
    (entry) => !refreshedSourceIds.has(entry.source.sourceId),
  );
  const byId = new Map<string, AssetCatalogEntry>(
    retainedEntries.map((entry) => [entry.id, entry]),
  );

  for (const entry of newEntries) {
    byId.set(entry.id, entry);
  }

  return [...byId.values()].sort(compareAssetCatalogEntries);
}

/**
 * Builds asset status from the provided inputs.
 */
export function buildAssetStatus(source: SourceDefinition): AssetStatus {
  const installEligible = source.rules.allowMirror && source.rules.allowInstall;
  return {
    cataloged: true,
    mirrorEligible: source.rules.allowMirror,
    installEligible,
    activationEligible: installEligible,
  };
}

/**
 * Provides compute trust score for the lifecycle pipeline.
 */
export function computeTrustScore(input: {
  authorityTier: string;
  sourceKind: string;
  sourcePriority: number;
  publisherVerified: boolean;
  compatibilityMode: CompatibilityMode;
  installMethod: string;
}): number {
  const baseAuthorityScore = getAuthorityRank(input.authorityTier) * 10;
  const sourcePriorityScore = Math.min(
    20,
    Math.round(input.sourcePriority / 5),
  );
  const verificationScore = input.publisherVerified ? 10 : 0;
  const compatibilityScore = getCompatibilityRank(input.compatibilityMode) * 4;
  const installMethodScore =
    input.installMethod === "local-file"
      ? 10
      : input.installMethod === "github-tree-metadata"
        ? 8
        : input.installMethod === "official-index-entry"
          ? 6
          : 4;

  return (
    baseAuthorityScore +
    sourcePriorityScore +
    verificationScore +
    compatibilityScore +
    installMethodScore
  );
}

/**
 * Builds trust signals from the provided inputs.
 */
export function buildTrustSignals(input: {
  authorityTier: string;
  sourceKind: string;
  sourcePriority: number;
  publisherVerified: boolean;
  compatibilityMode: CompatibilityMode;
  installMethod: string;
}): string[] {
  const signals = [
    `authority:${input.authorityTier}`,
    `source-kind:${input.sourceKind}`,
    `source-priority:${input.sourcePriority}`,
    `compatibility:${input.compatibilityMode}`,
    `install-method:${input.installMethod}`,
  ];

  if (input.publisherVerified) {
    signals.push("publisher-verified");
  }

  return signals;
}

/**
 * Provides enhance trust for entry for the lifecycle pipeline.
 */
export function enhanceTrustForEntry(
  entry: AssetCatalogEntry,
): AssetCatalogEntry {
  let adjustedTrustScore = entry.trust.score;
  const adjustedTrustSignals = [...entry.trust.signals];

  if (entry.maintenance.stars >= 1000) {
    adjustedTrustScore += 10;
    adjustedTrustSignals.push("stars:1000+");
  } else if (entry.maintenance.stars >= 100) {
    adjustedTrustScore += 8;
    adjustedTrustSignals.push("stars:100+");
  } else if (entry.maintenance.stars >= 10) {
    adjustedTrustScore += 4;
    adjustedTrustSignals.push("stars:10+");
  }

  if (entry.maintenance.releaseCadence === "active") {
    adjustedTrustScore += 5;
    adjustedTrustSignals.push("maintenance:active");
  }

  if (entry.maintenance.releaseCadence === "archived") {
    adjustedTrustScore -= 12;
    adjustedTrustSignals.push("maintenance:archived");
  }

  if (entry.evidence.readmeFound) {
    adjustedTrustScore += 4;
    adjustedTrustSignals.push("readme-present");
  }

  if (entry.evidence.docsLinked) {
    adjustedTrustScore += 4;
    adjustedTrustSignals.push("docs-linked");
  }

  if (entry.evidence.frontmatterFound) {
    adjustedTrustScore += 2;
    adjustedTrustSignals.push("frontmatter-present");
  }

  if ((entry.evidence.dependencies?.length ?? 0) > 0) {
    adjustedTrustScore += 2;
    adjustedTrustSignals.push("dependencies-declared");
  }

  if (entry.risk.level === "medium") {
    adjustedTrustScore -= 5;
    adjustedTrustSignals.push("risk:medium");
  }

  if (entry.risk.level === "high") {
    adjustedTrustScore -= 15;
    adjustedTrustSignals.push("risk:high");
  }

  if (
    entry.source.authorityTier === "trusted-community" &&
    entry.maintenance.stars === 0 &&
    !entry.evidence.readmeFound
  ) {
    adjustedTrustScore -= 8;
    adjustedTrustSignals.push("community:low-evidence");
  }

  return {
    ...entry,
    trust: {
      score: adjustedTrustScore,
      signals: adjustedTrustSignals,
    },
  };
}

/**
 * Builds catalog id from the provided inputs.
 */
export function buildCatalogId(sourceId: string, assetPath: string): string {
  return `${sourceId}:${encodeCatalogPath(assetPath)}`;
}

/**
 * Compares asset catalog entries values for stable ordering.
 */
export function compareAssetCatalogEntries(
  left: AssetCatalogEntry,
  right: AssetCatalogEntry,
): number {
  return left.id.localeCompare(right.id);
}

/**
 * Provides split into keywords for the lifecycle pipeline.
 */
/**
 * English stopwords + language-neutral noise tokens.
 * Filtered from capability extraction and representative queries.
 * Tickets: #400, #406.
 */
export const STOPWORD_TOKENS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "not",
  "no",
  "nor",
  "so",
  "if",
  "then",
  "than",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "he",
  "she",
  "they",
  "them",
  "their",
  "we",
  "us",
  "our",
  "my",
  "your",
  "his",
  "her",
  "me",
  "you",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "just",
  "about",
  "up",
  "out",
  "as",
  "into",
  "over",
  "under",
  "after",
  "before",
  "between",
  "through",
  "during",
  "above",
  "below",
  "any",
  "what",
  "which",
  "who",
  "whom",
  "where",
  "when",
  "why",
  "how",
  "very",
  "too",
  "also",
  "now",
  "here",
  "there",
  "one",
  "two",
  "zero",
]);

/**
 * Splits a string into lowercase keyword tokens, filtering out stopwords,
 * single-character tokens, and numeric-only tokens.
 * Used by all capability extraction paths.
 */
export function splitIntoKeywords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.md$/u, "")
    .replace(/\.(ts|js|mts|cts)$/u, "")
    .split(/[^a-z0-9]+/u)
    .filter((token) => {
      if (token.length < 2) return false;
      if (/^\d+$/u.test(token)) return false;
      if (STOPWORD_TOKENS.has(token)) return false;
      return true;
    });
}

/**
 * Provides unique strings for the lifecycle pipeline.
 */
export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Provides last path segment for the lifecycle pipeline.
 */
export function lastPathSegment(value: string): string {
  const normalizedValue = value.replace(/\/+/gu, "/");
  const segments = normalizedValue
    .split("/")
    .filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1] ?? value;
  return lastSegment.replace(/\.(md|mdc|ts|js|mts|cts)$/u, "");
}

/**
 * Derives a human-readable display name from a catalog path.
 */
export function deriveDisplayNameFromPath(relativePath: string): string {
  const pathSegments = relativePath
    .replace(/\\/gu, "/")
    .split("/")
    .filter((segment) => segment.length > 0);
  const fileSegment = pathSegments[pathSegments.length - 1] ?? relativePath;
  const baseSegment = normalizeDisplayNameSegment(lastPathSegment(fileSegment));

  if (GENERIC_DISPLAY_NAME_SEGMENTS.has(baseSegment)) {
    for (const parentSegment of pathSegments.slice(0, -1).reverse()) {
      const normalizedParent = normalizeDisplayNameSegment(parentSegment);
      if (!GENERIC_DISPLAY_NAME_SEGMENTS.has(normalizedParent)) {
        return humanizeSlug(parentSegment);
      }
    }
  }

  return humanizeSlug(lastPathSegment(fileSegment));
}

/**
 * Provides humanize slug for the lifecycle pipeline.
 */
export function humanizeSlug(value: string): string {
  return value
    .replace(/\.(md|mdc|markdown|txt|ya?ml|json)$/iu, "")
    .split(/[-_/]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function normalizeDisplayNameSegment(value: string): string {
  return value
    .replace(/\.(md|mdc|markdown|txt|ya?ml|json)$/iu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/**
 * Compares sources by priority values for stable ordering.
 */
export function compareSourcesByPriority(
  left: SourceDefinition,
  right: SourceDefinition,
): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  return left.id.localeCompare(right.id);
}

function getAuthorityRank(authorityTier: string): number {
  const authorityRanks: Record<string, number> = {
    "official-first-party": 6,
    "official-marketplace": 5,
    "official-compatible": 4,
    "trusted-local": 3,
    "trusted-community": 2,
    "unverified-community": 1,
  };

  return authorityRanks[authorityTier] ?? 0;
}

function getCompatibilityRank(compatibilityMode: CompatibilityMode): number {
  const compatibilityRanks: Record<CompatibilityMode, number> = {
    native: 5,
    adaptable: 4,
    partial: 3,
    "reference-only": 2,
    incompatible: 1,
  };

  return compatibilityRanks[compatibilityMode];
}

function encodeCatalogPath(assetPath: string): string {
  const segments = assetPath
    .replace(/\\/gu, "/")
    .split("/")
    .filter((segment) => segment.length > 0);
  const encodedPath = encodeURIComponent(segments.join("/"));

  return encodedPath.length > 0 ? encodedPath : "root";
}
