import type {
  AssetCatalogEntry,
  AssetContextCost,
  AssetRisk,
  CompatibilityMode,
  SelectionRegistry,
} from "../../types.js";

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
