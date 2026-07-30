/**
 * Shared test helpers for agent-harness test suite.
 *
 * Provides canonical fixture builders used across multiple test files.
 */

import type { AssetCatalogEntry, AssetKind } from "../types.js";

export type PartialEntry = Partial<AssetCatalogEntry> & {
  id: string;
  displayName: string;
  assetKind: AssetKind;
};

/**
 * Canonical AssetCatalogEntry builder with sensible defaults.
 * Override any field via the partial overrides parameter.
 */
export function buildEntry(overrides: PartialEntry): AssetCatalogEntry {
  return {
    id: overrides.id,
    displayName: overrides.displayName,
    assetKind: overrides.assetKind,
    hosts: overrides.hosts ?? ["claude-code"],
    compatibilityMode: overrides.compatibilityMode ?? "adaptable",
    source: {
      sourceId: overrides.source?.sourceId ?? "test-source",
      authorityTier: overrides.source?.authorityTier ?? "unverified-community",
      sourceKind: overrides.source?.sourceKind ?? "repo",
      sourcePriority: overrides.source?.sourcePriority ?? 70,
      originUrl: overrides.source?.originUrl ?? "https://example.com/test",
      publisher: overrides.source?.publisher ?? "test-publisher",
      publisherVerified: overrides.source?.publisherVerified ?? false,
    },
    trust: {
      score: overrides.trust?.score ?? 50,
      signals: overrides.trust?.signals ?? [],
    },
    capabilities: overrides.capabilities ?? ["test"],
    install: {
      method: overrides.install?.method ?? "repo-reference",
      manifestEntry:
        overrides.install?.manifestEntry ??
        "https://example.com/test/manifest.json",
    },
    evidence: {
      manifestFound: overrides.evidence?.manifestFound ?? true,
      readmeFound: overrides.evidence?.readmeFound ?? true,
      examplesFound: overrides.evidence?.examplesFound ?? false,
      docsLinked: overrides.evidence?.docsLinked ?? true,
      lineCount: overrides.evidence?.lineCount ?? 10,
      rootPath: overrides.evidence?.rootPath ?? "https://example.com/test",
      classification: overrides.evidence?.classification ?? null,
    },
    maintenance: {
      lastUpdated: overrides.maintenance?.lastUpdated ?? "2026-01-01T00:00:00Z",
      stars: overrides.maintenance?.stars ?? 0,
      releaseCadence: overrides.maintenance?.releaseCadence ?? "occasional",
    },
    risk: overrides.risk ?? {
      hooks: false,
      execScripts: false,
      requiresNetwork: false,
    },
    contextCost: overrides.contextCost ?? {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: overrides.fit ?? { portfolioFit: 0.5, hostFit: 0.5 },
    dedupe: overrides.dedupe ?? {
      duplicateGroup: null,
      candidateRankHint: 0,
    },
    status: overrides.status ?? "fresh",
  } as AssetCatalogEntry;
}
