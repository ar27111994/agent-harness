/**
 * ARD Registry adapter for source-sync (#327).
 *
 * Consumes ARD-compliant registries via POST /search, maps results to
 * AssetCatalogEntry, persists federated referrals, and supports cursor-based
 * pagination via pageToken.
 */

import type { AssetKind, SourceDefinition } from "../../../../types.js";
import { buildReferenceSourceCatalogEntry } from "../../reference-source-harvester.js";
import { splitIntoKeywords, uniqueStrings } from "../../catalog-utils.js";
import {
  ardTypeToAssetKind,
  buildArdQueryText,
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
  getAllowedOrigins,
  fetchRequiredJson,
  SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

const DEFAULT_PORTFOLIO_FIT = 0.5;
const ARD_SCORE_MAX = 100;
const SYNTHETIC_CAPABILITY_QUERY_LIMIT = 3;
const ARD_REPRESENTATIVE_QUERY_LIMIT = 5;
const ASSET_KINDS = new Set<AssetKind>([
  "skill",
  "plugin",
  "mcp-server",
  "agent",
  "instruction",
  "workflow",
  "hook",
  "extension",
  "prompt-pack",
  "reference-pack",
  "payable-api",
  "acp-agent",
]);

function isAssetKind(value: string | undefined): value is AssetKind {
  return value !== undefined && ASSET_KINDS.has(value as AssetKind);
}

function extractArdTrustSignals(tm?: Record<string, unknown>): string[] {
  const signals: string[] = [];
  if (!tm) return signals;

  if (tm.identity) signals.push("ard-identity-bound");
  const attestations = Array.isArray(tm.attestations) ? tm.attestations : [];
  if (attestations.length > 0) {
    signals.push("ard-compliance-attested");
    for (const item of attestations) {
      const attestation = asRecord(item);
      if (getString(attestation.type) === "SOC2-Type2")
        signals.push("ard-soc2");
      if (getString(attestation.type) === "HIPAA-Audit")
        signals.push("ard-hipaa");
    }
  }
  if (tm.signature) signals.push("ard-signed");

  return signals;
}

function computeArdTrustScore(signals: string[]): number {
  let score = 0;
  for (const signal of signals) score += TRUST_SIGNAL_SCORE_BOOST[signal] ?? 0;
  return score;
}

function normalizeScoreToPortfolioFit(score?: number): number {
  if (score === undefined) return DEFAULT_PORTFOLIO_FIT;
  return Math.max(0, Math.min(1, score / ARD_SCORE_MAX));
}

/** Syncs an ARD-compliant registry via POST /search. */
export async function syncArdRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursorStates = getPreviousCursorStates(context.previousState);
  const previousCursor = restoreFiniteCursorState(previousCursorStates[0], {
    cursorId: "pageToken",
    nextToken: undefined,
    completed: false,
  });
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
  const allReferrals: unknown[] = [];
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

    const data = await fetchRequiredJson(
      apiUrl,
      getAllowedOrigins(apiUrl),
      {},
      {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      },
    );
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

      // ARD 1.0 provides `metadata` for primitive custom extensions. Agent
      // Harness writes its round-trip AssetKind there when a URL is present;
      // older federated catalogs may still carry the same field in `data`.
      const metadata = asOptionalRecord(result.metadata);
      const inlineData = asOptionalRecord(result.data);
      const roundTripAssetKind =
        getString(metadata?.assetKind) ?? getString(inlineData?.assetKind);
      const assetKind = isAssetKind(roundTripAssetKind)
        ? roundTripAssetKind
        : ardTypeToAssetKind(ardType);

      const resultCapabilities = Array.isArray(result.capabilities)
        ? result.capabilities.filter(
            (capability): capability is string =>
              typeof capability === "string",
          )
        : [];
      const resultTags = Array.isArray(result.tags)
        ? result.tags.filter((tag): tag is string => typeof tag === "string")
        : [];

      const trustSignals =
        source.authorityTier === "official-first-party"
          ? extractArdTrustSignals(
              result.trustManifest as Record<string, unknown> | undefined,
            )
          : [];

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

      const ardTrustScore = computeArdTrustScore(trustSignals);
      if (ardTrustScore > 0) {
        entry.trust = {
          ...entry.trust,
          score: entry.trust.score + ardTrustScore,
          signals: uniqueStrings([...entry.trust.signals, ...trustSignals]),
        };
      }

      const rawScore =
        typeof result.score === "number" ? result.score : undefined;
      entry.fit = {
        ...entry.fit,
        portfolioFit: normalizeScoreToPortfolioFit(rawScore),
      };

      const syntheticQueries = [
        `What ${assetKind} assets are available from ${source.id}?`,
        `Find ${displayName.toLowerCase()} for agent workflows`,
        ...resultCapabilities
          .slice(0, SYNTHETIC_CAPABILITY_QUERY_LIMIT)
          .map((capability) => `Install a ${assetKind} for ${capability}`),
      ].slice(0, ARD_REPRESENTATIVE_QUERY_LIMIT);
      entry.representativeQueries = syntheticQueries;

      upsertIndexedCatalogEntry(context, entry);
      totalIndexed += 1;
      pageIndexed += 1;
    }

    totalPages += 1;
    if (Array.isArray(response.referrals) && response.referrals.length > 0) {
      allReferrals.push(...response.referrals);
    }

    const nextToken = getString(response.pageToken);
    if (nextToken && pageIndexed > 0) pageToken = nextToken;
    else completed = true;
  }

  if (allReferrals.length > 0) {
    const { writeJsonFile } = await import("../../../../files.js");
    const { join } = await import("node:path");
    try {
      await writeJsonFile(
        join(".agent-harness", "discover", "output", "ard-referrals.json"),
        {
          referrals: allReferrals,
          fetchedAt: new Date().toISOString(),
        },
      );
    } catch {
      console.warn("ard-registry: failed to persist federated referrals");
    }
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: completed ? "complete" : "partial",
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

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Exposes ARD registry conversion helpers for focused tests. */
export const ardRegistryInternals = {
  ardTypeToAssetKind,
  extractArdTrustSignals,
  computeArdTrustScore,
  normalizeScoreToPortfolioFit,
  asOptionalRecord,
};
