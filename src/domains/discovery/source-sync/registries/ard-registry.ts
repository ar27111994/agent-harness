/**
 * ARD Registry adapter for source-sync (#327).
 *
 * Consumes ARD-compliant registries via POST /search, maps results to
 * AssetCatalogEntry, persists federated referrals, and supports cursor-based
 * pagination via pageToken.
 *
 * Spec: https://agenticresourcediscovery.org/spec (§7)
 */

import type { SourceDefinition } from "../../../../types.js";
import { buildReferenceSourceCatalogEntry } from "../../reference-source-harvester.js";
import { splitIntoKeywords, uniqueStrings } from "../../catalog-utils.js";
import {
  ardTypeToAssetKind,
  buildArdQueryText,
  inferAuthorityTierFromArdUrn,
  TRUST_SIGNAL_SCORE_BOOST,
} from "../../../../ard/types.js";

import {
  getPreviousCursorStates,
  restoreFiniteCursorState,
  upsertIndexedCatalogEntry,
  getEffectiveMaxPagesPerRun,
} from "../state.js";
import {
  asRecord,
  getString,
  SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP,
} from "../fetching.js";
import { fetchJsonWithGuards } from "../../../../lib/http.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers (mapping functions imported from ../../../../ard/types.js)
// ---------------------------------------------------------------------------

/** Derives trust signals from ARD trustManifest. */
function deriveArdTrustSignals(tm?: Record<string, unknown>): string[] {
  const signals: string[] = [];
  if (!tm) return signals;

  if (tm.identity) signals.push("ard-identity-bound");
  const attestations = Array.isArray(tm.attestations) ? tm.attestations : [];
  if (attestations.length > 0) {
    signals.push("ard-compliance-attested");
    for (const a of attestations) {
      const att = asRecord(a);
      if (getString(att.type) === "SOC2-Type2") signals.push("ard-soc2");
      if (getString(att.type) === "HIPAA-Audit") signals.push("ard-hipaa");
    }
  }
  if (tm.signature) signals.push("ard-signed");

  return signals;
}

/** Computes trust score from ARD signals using centralized constants. */
function computeArdTrustScore(signals: string[]): number {
  let score = 0;
  for (const signal of signals) {
    score += TRUST_SIGNAL_SCORE_BOOST[signal] ?? 0;
  }
  return score;
}

/** Normalizes ARD semantic score (0–100) to portfolioFit (0.0–1.0). */
function normalizeScoreToPortfolioFit(score?: number): number {
  const DEFAULT_FIT = 0.5;
  const SCORE_MAX = 100;
  if (score === undefined) return DEFAULT_FIT;
  return Math.max(0, Math.min(1, score / SCORE_MAX));
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Syncs an ARD-compliant registry via POST /search with pageToken-based
 * pagination (#327).
 */
export async function syncArdRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = restoreFiniteCursorState(
    getPreviousCursorStates(context.previousState)[0],
    {
      cursorId: "pageToken",
      nextToken: undefined,
      completed: false,
    },
  );
  const apiUrl = source.endpoints.apiUrl ?? source.endpoints.searchUrl;
  if (!apiUrl) {
    return {
      sourceId: source.id,
      coverageMode: "indexed",
      status: "complete",
      indexedEntryCount: 0,
      cursors: [
        { cursorId: "pageToken", nextToken: undefined, completed: true },
      ],
    };
  }

  let pageToken: string | undefined = previousCursor.nextToken;
  let completed = previousCursor.completed;
  let totalIndexed = 0;
  let totalPages = 0;
  const effectiveMaxPages = getEffectiveMaxPagesPerRun(context);

  if (previousCursor.completed) {
    return {
      sourceId: source.id,
      coverageMode: "indexed",
      status: "complete",
      indexedEntryCount: 0,
      cursors: [
        { cursorId: "pageToken", nextToken: undefined, completed: true },
      ],
    };
  }

  const queryText = buildArdQueryText(context.demandProfile);

  while (!completed) {
    if (
      totalIndexed >= SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP ||
      (effectiveMaxPages > 0 && totalPages >= effectiveMaxPages)
    ) {
      break;
    }

    const body = JSON.stringify({
      query: { text: queryText },
      federation: "referrals",
      pageSize: 50,
      ...(pageToken ? { pageToken } : {}),
    });

    const data = await fetchJsonWithGuards(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (data === null) break;
    const response = asRecord(data);

    const results = Array.isArray(response.results) ? response.results : [];
    let pageIndexed = 0;

    for (const item of results) {
      if (totalIndexed >= SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP) break;

      const result = asRecord(item);
      const displayName = getString(result.displayName) ?? "ARD asset";
      const ardType = getString(result.type) ?? "application/ai-skill";
      const description = getString(result.description);
      const originUrl =
        getString(result.url) ?? getString(result.source) ?? apiUrl;

      const assetKind = ardTypeToAssetKind(ardType) as
        | "skill"
        | "mcp-server"
        | "agent"
        | "reference-pack"
        | "payable-api";

      const resultCapabilities = Array.isArray(result.capabilities)
        ? result.capabilities.filter((c): c is string => typeof c === "string")
        : [];
      const resultTags = Array.isArray(result.tags)
        ? result.tags.filter((t): t is string => typeof t === "string")
        : [];

      const trustSignals = deriveArdTrustSignals(
        result.trustManifest as Record<string, unknown> | undefined,
      );

      const entry = buildReferenceSourceCatalogEntry(
        source,
        context.demandProfile,
        context.selectionRegistry,
        {
          harvestedItem: {
            displayName,
            originUrl,
            summary: description ?? "",
            capabilities: [
              ...resultCapabilities,
              ...splitIntoKeywords(displayName),
              ...resultTags,
            ],
            assetKind,
            compatibilityMode: "adaptable",
            installMethod: "ard-registry-search",
            trustSignals,
            lastUpdated: getString(result.updatedAt) ?? undefined,
          },
          originUrl,
        },
      );

      // Augment trust with ARD-derived signals
      const ardTrustScore = computeArdTrustScore(trustSignals);
      if (ardTrustScore > 0) {
        entry.trust = {
          ...entry.trust,
          score: entry.trust.score + ardTrustScore,
          signals: uniqueStrings([...entry.trust.signals, ...trustSignals]),
        };
      }

      // Normalize semantic score to portfolio fit
      const rawScore =
        typeof result.score === "number" ? result.score : undefined;
      entry.fit = {
        ...entry.fit,
        portfolioFit: normalizeScoreToPortfolioFit(rawScore),
      };

      // Infer authority tier from the entry's URN publisher domain
      if (result.identifier) {
        const URN_MIN_PARTS = 4;
        const urnParts = String(result.identifier).split(":");
        if (urnParts.length >= URN_MIN_PARTS) {
          const publisherDomain = urnParts[3];
          entry.source.authorityTier =
            inferAuthorityTierFromArdUrn(publisherDomain);
        }
      }

      upsertIndexedCatalogEntry(context, entry);
      totalIndexed++;
      pageIndexed++;
    }

    totalPages++;

    // Persist referrals for federation
    const referrals = response.referrals;
    if (Array.isArray(referrals) && referrals.length > 0) {
      const { writeJsonFile } = await import("../../../../files.js");
      const { join } = await import("node:path");
      try {
        await writeJsonFile(
          join(".agent-harness", "discover", "output", "ard-referrals.json"),
          {
            referrals,
            fetchedAt: new Date().toISOString(),
          },
        );
      } catch {
        // Non-critical — referral persistence is best-effort.
        console.warn("ard-registry: failed to persist federated referrals");
      }
    }

    const nextToken = getString(response.pageToken);
    if (nextToken && pageIndexed > 0) {
      pageToken = nextToken;
    } else {
      completed = true;
    }
  }

  const atCap = totalIndexed >= SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP;
  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: atCap && !completed ? "partial" : "complete",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: totalIndexed,
    cursors: [
      {
        cursorId: "pageToken",
        nextToken: completed ? undefined : pageToken,
        completed,
      },
    ],
  };
}

/**
 * Expose internals for unit testing.
 */
export const ardRegistryInternals = {
  ardTypeToAssetKind,
  deriveArdTrustSignals,
  computeArdTrustScore,
  normalizeScoreToPortfolioFit,
};
