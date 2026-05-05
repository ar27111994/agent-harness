import { splitIntoKeywords } from "./catalog-utils.js";
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

/**
 * Filters catalog entries to assets that overlap with workspace demand signals.
 */
export function filterCatalogEntriesByDemandRelevance(
  catalogEntries: AssetCatalogEntry[],
  demandProfile: DemandProfile | null,
): RelevanceFilterResult {
  const demandTerms = buildDemandTermSet(demandProfile);

  if (demandTerms.size === 0) {
    return { selectedEntries: catalogEntries, rejectedEntries: [] };
  }

  const selectedEntries: AssetCatalogEntry[] = [];
  const rejectedEntries: AssetCatalogEntry[] = [];

  for (const entry of catalogEntries) {
    if (isEntryRelevantToDemand(entry, demandTerms)) {
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

function buildDemandTermSet(demandProfile: DemandProfile | null): Set<string> {
  if (!demandProfile) {
    return new Set();
  }

  return new Set(
    [
      ...demandProfile.signals.languages,
      ...demandProfile.signals.frameworks,
      ...demandProfile.signals.concerns,
      ...demandProfile.signals.tooling,
    ].flatMap((value) => splitIntoKeywords(stripPackageEvidencePrefix(value))),
  );
}

function stripPackageEvidencePrefix(value: string): string {
  return value.replace(
    /^(?:cargo|cocoapods|gem|go|gradle|maven|npm|nuget|packagist|pub|pypi|swift):/iu,
    "",
  );
}

function isEntryRelevantToDemand(
  entry: AssetCatalogEntry,
  demandTerms: Set<string>,
): boolean {
  if (isExecutableMcpServerEntry(entry)) {
    return true;
  }

  if (entry.fit.portfolioFit > 0) {
    return true;
  }

  const entryTerms = new Set(
    [
      entry.id,
      entry.displayName,
      entry.source.sourceId,
      entry.source.publisher,
      ...entry.capabilities,
      entry.install.relativePath ?? "",
      entry.install.manifestEntry ?? "",
      entry.evidence.filePath ?? "",
    ].flatMap((value) => splitIntoKeywords(value)),
  );

  for (const demandTerm of demandTerms) {
    if (entryTerms.has(demandTerm)) {
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
