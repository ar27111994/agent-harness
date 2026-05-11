import { splitIntoKeywords } from "./catalog-utils.js";
import { hasDesignSystemSignals, SPECIALIZED_GATES } from "./demand-helpers.js";
import { stripPackageManifestEntryPrefix } from "../../lib/package-manifest-entry.js";
import type {
  AssetCatalogEntry,
  AssetContextCost,
  AssetRisk,
  CompatibilityMode,
  DemandProfile,
  SelectionRegistry,
} from "../../types.js";

interface RelevanceFilterResult {
  selectedEntries: AssetCatalogEntry[];
  rejectedEntries: AssetCatalogEntry[];
}

interface DemandRelevanceTerms {
  exactHighSignalTerms: Set<string>;
  highSignalPhrases: string[][];
  lowSignalTerms: Set<string>;
  demandKeywords: Set<string>;
  stackAnchorTerms: Set<string>;
  primaryStackAnchorTerms: Set<string>;
}

interface CatalogTermData {
  documentFrequency: Map<string, number>;
  entryTermsByEntry: Map<AssetCatalogEntry, Set<string>>;
}

const LOW_SIGNAL_TERMS = new Set([
  "api",
  "automation",
  "backend",
  "bun",
  "bundler",
  "cargo",
  "cd",
  "ci",
  "cloud",
  "composer",
  "data",
  "database",
  "debugging",
  "devops",
  "docker",
  "documentation",
  "express",
  "frontend",
  "fullstack",
  "go",
  "gradle",
  "infrastructure",
  "integration",
  "javascript",
  "knowledge",
  "logging",
  "maven",
  "mobile",
  "node",
  "npm",
  "nuget",
  "pip",
  "pnpm",
  "pub",
  "python",
  "react",
  "swift",
  "testing",
  "tooling",
  "typescript",
  "yarn",
]);

const IGNORED_CONCERN_TERMS = new Set(["base", "detector"]);
const LOW_SIGNAL_CONCERN_MATCH_THRESHOLD = 4;
const HIGH_SIGNAL_PHRASE_MATCH_THRESHOLD = 2;
const COMMON_HIGH_SIGNAL_CATALOG_SHARE_THRESHOLD = 0.2;
const MIN_CATALOG_SIZE_FOR_COMMON_HIGH_SIGNAL_FILTER = 200;
const TRUSTED_LOCAL_GENERIC_OVERLAP_REJECTION_THRESHOLD = 4;
const TRUSTED_LOCAL_STRONG_ANCHOR_MIN_COUNT = 2;
const TRUSTED_LOCAL_GUIDANCE_ASSET_KINDS = new Set([
  "skill",
  "agent",
  "instruction",
  "workflow",
  "prompt-pack",
]);
const TRUSTED_LOCAL_SOURCE_KINDS = new Set([
  "local-directory",
  "local-manifest",
]);

/**
 * Filters catalog entries to assets that overlap with workspace demand signals.
 */
export function filterCatalogEntriesByDemandRelevance(
  catalogEntries: AssetCatalogEntry[],
  demandProfile: DemandProfile | null,
): RelevanceFilterResult {
  const catalogTermData = buildCatalogTermData(catalogEntries);
  const demandTerms = buildDemandTermSet(
    demandProfile,
    catalogTermData.documentFrequency,
    catalogEntries.length,
  );

  if (
    demandTerms.exactHighSignalTerms.size === 0 &&
    demandTerms.highSignalPhrases.length === 0 &&
    demandTerms.lowSignalTerms.size === 0
  ) {
    return { selectedEntries: catalogEntries, rejectedEntries: [] };
  }

  const selectedEntries: AssetCatalogEntry[] = [];
  const rejectedEntries: AssetCatalogEntry[] = [];

  for (const entry of catalogEntries) {
    const entryTerms =
      catalogTermData.entryTermsByEntry.get(entry) ?? new Set();
    if (isEntryRelevantToDemand(entry, entryTerms, demandTerms)) {
      selectedEntries.push(entry);
    } else {
      rejectedEntries.push(entry);
    }
  }

  return { selectedEntries, rejectedEntries };
}

/**
 * Groups catalog entries for selection in the lifecycle pipeline.
 */
export function groupCatalogEntriesForSelection(
  catalogEntries: AssetCatalogEntry[],
): Map<string, AssetCatalogEntry[]> {
  const groupedEntries = new Map<string, AssetCatalogEntry[]>();

  for (const entry of catalogEntries) {
    const groupKey = entry.dedupe.duplicateGroup ?? entry.id;
    const existingEntries = groupedEntries.get(groupKey) ?? [];
    existingEntries.push(entry);
    groupedEntries.set(groupKey, existingEntries);
  }

  return groupedEntries;
}

/**
 * Compares selection candidate values for stable ordering.
 */
export function compareSelectionCandidates(
  left: AssetCatalogEntry,
  right: AssetCatalogEntry,
  selectionRegistry: SelectionRegistry,
): number {
  const canonicalSourceDifference = compareNumberDescending(
    getCanonicalSourceRank(left.install.method),
    getCanonicalSourceRank(right.install.method),
  );
  if (canonicalSourceDifference !== 0) {
    return canonicalSourceDifference;
  }

  const authorityDifference = compareNumberDescending(
    getAuthorityRank(left.source.authorityTier),
    getAuthorityRank(right.source.authorityTier),
  );
  if (authorityDifference !== 0) {
    return authorityDifference;
  }

  const compatibilityDifference = compareNumberDescending(
    getCompatibilityRank(left.compatibilityMode),
    getCompatibilityRank(right.compatibilityMode),
  );
  if (compatibilityDifference !== 0) {
    return compatibilityDifference;
  }

  const portfolioFitDifference = compareNumberDescending(
    left.fit.portfolioFit,
    right.fit.portfolioFit,
  );
  if (portfolioFitDifference !== 0) {
    return portfolioFitDifference;
  }

  const riskDifference = compareNumberAscending(
    getRiskRank(left.risk.level),
    getRiskRank(right.risk.level),
  );
  if (riskDifference !== 0) {
    return riskDifference;
  }

  const contextCostDifference = compareNumberAscending(
    getContextSizeRank(left.contextCost.sizeClass),
    getContextSizeRank(right.contextCost.sizeClass),
  );
  if (contextCostDifference !== 0) {
    return contextCostDifference;
  }

  const maintenanceDifference = compareStringDescending(
    left.maintenance.lastUpdated,
    right.maintenance.lastUpdated,
  );
  if (maintenanceDifference !== 0) {
    return maintenanceDifference;
  }

  if (selectionRegistry.selectionPolicies.starsAreTieBreakerOnly) {
    const starsDifference = compareNumberDescending(
      left.maintenance.stars,
      right.maintenance.stars,
    );
    if (starsDifference !== 0) {
      return starsDifference;
    }
  }

  return left.id.localeCompare(right.id);
}

/**
 * Builds selection reason from the provided inputs.
 */
export function buildSelectionReason(
  selectedEntry: AssetCatalogEntry,
  selectionRegistry: SelectionRegistry,
): string {
  const duplicateGroupId = selectedEntry.dedupe.duplicateGroup;

  if (duplicateGroupId) {
    const configuredDuplicateGroup = selectionRegistry.duplicateGroups.find(
      (duplicateGroup) => duplicateGroup.id === duplicateGroupId,
    );
    if (configuredDuplicateGroup) {
      return configuredDuplicateGroup.selectionReason;
    }
  }

  if (selectedEntry.source.authorityTier.startsWith("official")) {
    return "Selected because official sources outrank lower-authority alternatives regardless of popularity.";
  }

  if (selectedEntry.source.authorityTier === "trusted-local") {
    return "Selected because the local curated source outranked lower-trust alternatives after official-preference checks.";
  }

  return "Selected by compatibility, portfolio fit, risk, and context-cost ordering.";
}

function buildDemandTermSet(
  demandProfile: DemandProfile | null,
  catalogTermDocumentFrequency: Map<string, number>,
  catalogEntryCount: number,
): DemandRelevanceTerms {
  if (!demandProfile) {
    return {
      exactHighSignalTerms: new Set(),
      highSignalPhrases: [],
      lowSignalTerms: new Set(),
      demandKeywords: new Set(),
      stackAnchorTerms: new Set(),
      primaryStackAnchorTerms: new Set(),
    };
  }

  const exactHighSignalTerms = new Set<string>();
  const highSignalPhrases: string[][] = [];
  const lowSignalTerms = new Set<string>();
  const demandKeywords = new Set<string>();
  const stackAnchorTerms = new Set<string>();
  const primaryStackAnchorTerms = new Set<string>();

  for (const language of demandProfile.signals.languages) {
    addDemandSignal(
      language,
      exactHighSignalTerms,
      highSignalPhrases,
      lowSignalTerms,
      demandKeywords,
      catalogTermDocumentFrequency,
      catalogEntryCount,
      stackAnchorTerms,
      primaryStackAnchorTerms,
    );
  }

  for (const framework of demandProfile.signals.frameworks) {
    addDemandSignal(
      framework,
      exactHighSignalTerms,
      highSignalPhrases,
      lowSignalTerms,
      demandKeywords,
      catalogTermDocumentFrequency,
      catalogEntryCount,
      stackAnchorTerms,
      primaryStackAnchorTerms,
    );
  }

  for (const packageManager of demandProfile.signals.packageManagers) {
    addDemandSignal(
      packageManager,
      exactHighSignalTerms,
      highSignalPhrases,
      lowSignalTerms,
      demandKeywords,
      catalogTermDocumentFrequency,
      catalogEntryCount,
      stackAnchorTerms,
      primaryStackAnchorTerms,
    );
  }

  // Concerns intentionally stay out of stackAnchorTerms: addDemandSignal still
  // boosts demand matching for them, but only stack/bridge identifiers gathered
  // here and via addBridgeDemandTerms should influence trusted-local rejection.
  for (const concern of demandProfile.signals.concerns) {
    addDemandSignal(
      concern,
      exactHighSignalTerms,
      highSignalPhrases,
      lowSignalTerms,
      demandKeywords,
      catalogTermDocumentFrequency,
      catalogEntryCount,
    );
  }

  for (const tooling of demandProfile.signals.tooling) {
    addDemandSignal(
      tooling,
      exactHighSignalTerms,
      highSignalPhrases,
      lowSignalTerms,
      demandKeywords,
      catalogTermDocumentFrequency,
      catalogEntryCount,
      tooling.startsWith("detector:") ? undefined : stackAnchorTerms,
    );
  }

  addBridgeDemandTerms(
    demandProfile,
    exactHighSignalTerms,
    demandKeywords,
    stackAnchorTerms,
    primaryStackAnchorTerms,
  );

  return {
    exactHighSignalTerms,
    highSignalPhrases,
    lowSignalTerms,
    demandKeywords,
    stackAnchorTerms,
    primaryStackAnchorTerms,
  };
}

function addDemandSignal(
  value: string,
  exactHighSignalTerms: Set<string>,
  highSignalPhrases: string[][],
  lowSignalTerms: Set<string>,
  demandKeywords: Set<string>,
  catalogTermDocumentFrequency: Map<string, number>,
  catalogEntryCount: number,
  stackAnchorTerms?: Set<string>,
  primaryStackAnchorTerms?: Set<string>,
): void {
  const keywords = normalizeDemandSignalKeywords(value);
  for (const keyword of keywords) {
    demandKeywords.add(keyword);
  }
  if (keywords.length === 0) {
    return;
  }

  if (keywords.length === 1) {
    const classification = classifyDemandKeyword(
      keywords[0],
      catalogTermDocumentFrequency,
      catalogEntryCount,
    );
    if (classification === "low") {
      lowSignalTerms.add(keywords[0]);
    } else {
      exactHighSignalTerms.add(keywords[0]);
      stackAnchorTerms?.add(keywords[0]);
      primaryStackAnchorTerms?.add(keywords[0]);
    }
    return;
  }

  const uncommonKeywords = keywords.filter(
    (keyword) =>
      !LOW_SIGNAL_TERMS.has(keyword) &&
      !isCatalogCommonHighSignal(
        keyword,
        catalogTermDocumentFrequency,
        catalogEntryCount,
      ),
  );

  if (uncommonKeywords.length >= HIGH_SIGNAL_PHRASE_MATCH_THRESHOLD) {
    highSignalPhrases.push(uncommonKeywords);
    for (const keyword of uncommonKeywords) {
      stackAnchorTerms?.add(keyword);
      primaryStackAnchorTerms?.add(keyword);
    }
    return;
  }

  if (
    uncommonKeywords.length > 0 &&
    keywords.length >= HIGH_SIGNAL_PHRASE_MATCH_THRESHOLD
  ) {
    highSignalPhrases.push(keywords);
    for (const keyword of uncommonKeywords) {
      stackAnchorTerms?.add(keyword);
      primaryStackAnchorTerms?.add(keyword);
    }
    return;
  }

  for (const keyword of keywords) {
    lowSignalTerms.add(keyword);
  }
}

function classifyDemandKeyword(
  keyword: string,
  catalogTermDocumentFrequency: Map<string, number>,
  catalogEntryCount: number,
): "exact" | "low" {
  if (
    LOW_SIGNAL_TERMS.has(keyword) ||
    isCatalogCommonHighSignal(
      keyword,
      catalogTermDocumentFrequency,
      catalogEntryCount,
    )
  ) {
    return "low";
  }

  return "exact";
}

function normalizeDemandSignalKeywords(value: string): string[] {
  return Array.from(
    new Set(
      splitIntoKeywords(stripPackageEvidencePrefix(value)).filter(
        (keyword) => !IGNORED_CONCERN_TERMS.has(keyword),
      ),
    ),
  );
}

function addBridgeDemandTerms(
  demandProfile: DemandProfile,
  exactHighSignalTerms: Set<string>,
  demandKeywords: Set<string>,
  stackAnchorTerms: Set<string>,
  primaryStackAnchorTerms: Set<string>,
): void {
  if (hasDesignSystemSignals(demandProfile)) {
    exactHighSignalTerms.add("penpot");
    demandKeywords.add("penpot");
    stackAnchorTerms.add("penpot");
    primaryStackAnchorTerms.add("penpot");
  }
}

function isRejectedBySpecializedDemandGate(
  entryTerms: Set<string>,
  demandTerms: DemandRelevanceTerms,
): boolean {
  return SPECIALIZED_GATES.some(
    (gate) =>
      matchesTermGroupSet(entryTerms, gate.entryTermGroups) &&
      !matchesTermGroupSet(demandTerms.demandKeywords, gate.demandTermGroups),
  );
}

function matchesTermGroupSet(
  terms: Set<string>,
  termGroups: string[][],
): boolean {
  return termGroups.some((group) => group.every((term) => terms.has(term)));
}

function isCatalogCommonHighSignal(
  keyword: string,
  catalogTermDocumentFrequency: Map<string, number>,
  catalogEntryCount: number,
): boolean {
  if (catalogEntryCount < MIN_CATALOG_SIZE_FOR_COMMON_HIGH_SIGNAL_FILTER) {
    return false;
  }

  return (
    (catalogTermDocumentFrequency.get(keyword) ?? 0) / catalogEntryCount >=
    COMMON_HIGH_SIGNAL_CATALOG_SHARE_THRESHOLD
  );
}

function buildCatalogTermData(
  catalogEntries: AssetCatalogEntry[],
): CatalogTermData {
  const documentFrequency = new Map<string, number>();
  const entryTermsByEntry = new Map<AssetCatalogEntry, Set<string>>();

  for (const entry of catalogEntries) {
    const entryTerms = buildEntryTermSet(entry);
    entryTermsByEntry.set(entry, entryTerms);

    for (const term of entryTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return {
    documentFrequency,
    entryTermsByEntry,
  };
}

function stripPackageEvidencePrefix(value: string): string {
  return stripPackageManifestEntryPrefix(value);
}

function buildEntryTermSet(entry: AssetCatalogEntry): Set<string> {
  return new Set([
    ...entry.capabilities.flatMap((value) => splitIntoKeywords(value)),
    ...splitPathKeywords(entry.install.relativePath),
    ...splitPathKeywords(entry.install.manifestEntry),
    ...splitPathKeywords(entry.evidence.filePath),
  ]);
}

function splitPathKeywords(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return splitIntoKeywords(value).filter((token) => token.length > 1);
}

function isEntryRelevantToDemand(
  entry: AssetCatalogEntry,
  entryTerms: Set<string>,
  demandTerms: DemandRelevanceTerms,
): boolean {
  if (isExecutableMcpServerEntry(entry)) {
    return true;
  }

  if (isRejectedBySpecializedDemandGate(entryTerms, demandTerms)) {
    return false;
  }

  if (
    isRejectedByTrustedLocalWeakStackAlignment(entry, entryTerms, demandTerms)
  ) {
    return false;
  }

  if (isRejectedByTrustedLocalGenericOverlap(entry, entryTerms, demandTerms)) {
    return false;
  }

  for (const demandTerm of demandTerms.exactHighSignalTerms) {
    if (entryTerms.has(demandTerm)) {
      return true;
    }
  }

  for (const demandPhrase of demandTerms.highSignalPhrases) {
    let phraseMatchCount = 0;
    for (const demandTerm of demandPhrase) {
      if (entryTerms.has(demandTerm)) {
        phraseMatchCount += 1;
      }
    }

    if (
      phraseMatchCount >=
      Math.min(HIGH_SIGNAL_PHRASE_MATCH_THRESHOLD, demandPhrase.length)
    ) {
      return true;
    }
  }

  let lowSignalOverlapCount = 0;
  for (const demandTerm of demandTerms.lowSignalTerms) {
    if (!entryTerms.has(demandTerm)) {
      continue;
    }

    lowSignalOverlapCount += 1;
    if (lowSignalOverlapCount >= LOW_SIGNAL_CONCERN_MATCH_THRESHOLD) {
      return true;
    }
  }

  return false;
}

function isRejectedByTrustedLocalWeakStackAlignment(
  entry: AssetCatalogEntry,
  entryTerms: Set<string>,
  demandTerms: DemandRelevanceTerms,
): boolean {
  if (!isTrustedLocalGuidanceEntry(entry)) {
    return false;
  }

  if (
    demandTerms.primaryStackAnchorTerms.size === 0 &&
    demandTerms.stackAnchorTerms.size === 0
  ) {
    return false;
  }

  const hasStrongAnchors =
    demandTerms.primaryStackAnchorTerms.size > 0 ||
    demandTerms.stackAnchorTerms.size >= TRUSTED_LOCAL_STRONG_ANCHOR_MIN_COUNT;
  if (!hasStrongAnchors) {
    return false;
  }

  if (intersects(entryTerms, demandTerms.primaryStackAnchorTerms)) {
    return false;
  }

  return countOverlap(entryTerms, demandTerms.stackAnchorTerms) < 2;
}

function isRejectedByTrustedLocalGenericOverlap(
  entry: AssetCatalogEntry,
  entryTerms: Set<string>,
  demandTerms: DemandRelevanceTerms,
): boolean {
  if (
    !isTrustedLocalGuidanceEntry(entry) ||
    demandTerms.stackAnchorTerms.size === 0 ||
    intersects(entryTerms, demandTerms.stackAnchorTerms)
  ) {
    return false;
  }

  return (
    countOverlap(entryTerms, demandTerms.lowSignalTerms) >=
    TRUSTED_LOCAL_GENERIC_OVERLAP_REJECTION_THRESHOLD
  );
}

function isTrustedLocalGuidanceEntry(entry: AssetCatalogEntry): boolean {
  return (
    entry.source.authorityTier === "trusted-local" &&
    TRUSTED_LOCAL_SOURCE_KINDS.has(entry.source.sourceKind) &&
    TRUSTED_LOCAL_GUIDANCE_ASSET_KINDS.has(entry.assetKind)
  );
}

function countOverlap(left: Set<string>, right: Set<string>): number {
  let overlapCount = 0;

  for (const term of right) {
    if (left.has(term)) {
      overlapCount += 1;
    }
  }

  return overlapCount;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const term of left) {
    if (right.has(term)) {
      return true;
    }
  }

  return false;
}

function isExecutableMcpServerEntry(entry: AssetCatalogEntry): boolean {
  return (
    entry.assetKind === "mcp-server" &&
    (entry.source.sourceKind === "package-registry" ||
      (entry.status.installEligible &&
        (!entry.install.method.endsWith("-metadata") ||
          hasExecutableMcpSourcePath(entry))))
  );
}

function hasExecutableMcpSourcePath(entry: AssetCatalogEntry): boolean {
  return [entry.install.relativePath, entry.evidence.filePath].some(
    (filePath) => /\.(js|ts|mjs|cjs|mts|cts)$/iu.test(filePath ?? ""),
  );
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

  return compatibilityRanks[compatibilityMode] ?? 0;
}

function getRiskRank(riskLevel: AssetRisk["level"]): number {
  const riskRanks: Record<AssetRisk["level"], number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  return riskRanks[riskLevel];
}

function getContextSizeRank(sizeClass: AssetContextCost["sizeClass"]): number {
  const sizeRanks: Record<AssetContextCost["sizeClass"], number> = {
    tiny: 1,
    small: 2,
    medium: 3,
    large: 4,
  };

  return sizeRanks[sizeClass];
}

function getCanonicalSourceRank(installMethod: string): number {
  const canonicalSourceRanks: Record<string, number> = {
    "local-file": 4,
    "github-tree-metadata": 3,
    "manifest-entry": 2,
  };

  return canonicalSourceRanks[installMethod] ?? 1;
}

function compareNumberDescending(left: number, right: number): number {
  return right - left;
}

function compareNumberAscending(left: number, right: number): number {
  return left - right;
}

function compareStringDescending(left: string, right: string): number {
  return right.localeCompare(left);
}
