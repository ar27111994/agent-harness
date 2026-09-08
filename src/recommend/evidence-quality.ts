import type { AssetCatalogEntry, RecommendationSignalMatch } from "../types.js";
import { normalizePhrase } from "./signals.js";

const COLLISION_PRONE_TOKENS = new Set([
  "actor",
  "agent",
  "api",
  "benchmark",
  "client",
  "code",
  "extension",
  "plugin",
  "server",
  "tool",
  "tools",
]);

/**
 * Detects a marketplace recommendation whose demand match is unsupported by
 * semantic content. Empty-description entries may still match a distinctive
 * literal identity, but collision-prone tokens cannot establish exact-stack
 * fit on their own (#459).
 */
export function isTokenCoincidenceWithoutSemanticEvidence(
  entry: AssetCatalogEntry,
  matchedSignals: readonly RecommendationSignalMatch[],
  rawKeywordTerms: ReadonlySet<string>,
  packageIdentityByTerm: ReadonlyMap<string, ReadonlySet<string>>,
  assetRawIdentityTerms: ReadonlySet<string>,
): boolean {
  if (
    entry.source.sourceKind !== "marketplace" ||
    entry.evidence.readmeFound ||
    matchedSignals.length === 0
  ) {
    return false;
  }

  return !matchedSignals.some((match) => {
    const term = normalizePhrase(match.term);
    if (rawKeywordTerms.has(term) && !COLLISION_PRONE_TOKENS.has(term)) {
      return true;
    }

    const packageTokens = packageIdentityByTerm.get(match.term);
    return (
      packageTokens !== undefined &&
      [...packageTokens].some(
        (token) =>
          assetRawIdentityTerms.has(token) &&
          !COLLISION_PRONE_TOKENS.has(token),
      )
    );
  });
}

/** Exposes recommendation evidence constants for focused tests. */
export const evidenceQualityInternals = { COLLISION_PRONE_TOKENS } as const;
