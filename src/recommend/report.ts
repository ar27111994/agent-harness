import { join } from "node:path";

import {
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
} from "../files.js";
import {
  assertAssetCatalogEntry,
  assertDemandProfile,
} from "../manifest-validation.js";
import { REPORT_FILE_PATH } from "./constants.js";
import { getRecommendationHosts } from "./hosts.js";
import { loadRecommendationPolicy } from "./policy.js";
import { buildDemandContext, buildSynonymLookup } from "./signals.js";
import {
  buildCandidateRecommendationBase,
  buildPolicySearchContext,
} from "./candidates.js";
import { buildTopRecommendationsForHost } from "./selection.js";
import { buildHostSummary, buildSuggestedBundle } from "./summary.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  RecommendationEntry,
  RecommendationHostSummary,
  RecommendationPolicy,
  RecommendationReport,
  SessionIntent,
} from "../types.js";
import type { CandidateRecommendationBase } from "./model.js";
import type { RecommendationHost } from "./hosts.js";

/**
 * Thrown by {@link writeRecommendationReport} when the selected catalog is
 * absent or empty. The caller should run `discover full` or `discover select`
 * first to populate the catalog before running `recommend`.
 */
export class CatalogEmptyError extends Error {
  /** Absolute path of the catalog file that was absent or empty. */
  readonly catalogPath: string;

  constructor(catalogPath: string) {
    super(
      `No selected catalog entries found at ${catalogPath}.\n` +
        `Run 'discover full' or 'discover select' to build the catalog before running 'recommend'.`,
    );
    this.name = "CatalogEmptyError";
    this.catalogPath = catalogPath;
  }
}

/**
 * Writes recommendation report to project state.
 *
 * @throws {CatalogEmptyError} When `discover/output/catalog.selected.jsonl` is
 *   absent or empty. Callers must run `discover full` or `discover select` first.
 */
export async function writeRecommendationReport(
  projectRoot: string,
  options: {
    policy?: RecommendationPolicy;
    sessionIntent?: SessionIntent;
    sessionIntents?: readonly SessionIntent[];
  } = {},
): Promise<RecommendationReport> {
  // Check catalog first — fail fast before any expensive I/O (policy load,
  // demand-profile read). An empty or absent catalog means nothing can be
  // ranked; the user must run discover first.
  const catalogPath = join(
    projectRoot,
    "discover",
    "output",
    "catalog.selected.jsonl",
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    catalogPath,
    assertAssetCatalogEntry,
  );
  if (selectedEntries.length === 0) {
    throw new CatalogEmptyError(catalogPath);
  }
  const resolvedPolicy =
    options.policy ?? (await loadRecommendationPolicy(projectRoot));
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    assertDemandProfile,
  );
  const resolvedIntents = resolveSessionIntents(
    options.sessionIntents ?? options.sessionIntent,
  );
  const report = buildRecommendationReport(
    selectedEntries,
    demandProfile,
    resolvedPolicy,
    resolvedIntents,
  );

  await writeJsonFile(join(projectRoot, ...REPORT_FILE_PATH), report);

  return report;
}

/**
 * Builds recommendation report from the provided inputs.
 * Accepts one or more session intents; multiple intents are merged additively
 * through the demand context so the ranking reflects the combined task shape.
 * The first intent is recorded as the primary intent in the report output for
 * backward compatibility. A sessionIntents array is included only when more
 * than one intent was requested.
 */
export function buildRecommendationReport(
  entries: AssetCatalogEntry[],
  demandProfile: DemandProfile | null,
  policy: RecommendationPolicy,
  sessionIntents: SessionIntent | readonly SessionIntent[] = "general",
): RecommendationReport {
  const resolvedIntents = resolveSessionIntents(sessionIntents);
  const primaryIntent: SessionIntent = resolvedIntents[0];
  const demandContext = buildDemandContext(
    demandProfile,
    policy,
    resolvedIntents,
  );
  const recommendationHosts = getRecommendationHosts();
  const policyContext = buildPolicySearchContext(policy);
  // Build once per report run — not once per entry. With 2,000+ entries this
  // reduces synonym-canonicalization cost from O(entries × synonyms) to O(1)
  // per entry (a Map.get lookup).
  const synonymLookup = buildSynonymLookup(policy);
  const candidateBases = entries
    .filter((entry) => entry.compatibilityMode !== "incompatible")
    .map((entry) =>
      buildCandidateRecommendationBase(
        entry,
        demandContext,
        policy,
        policyContext,
        synonymLookup,
      ),
    )
    .filter((base): base is CandidateRecommendationBase => base !== null);
  const topByHost = Object.fromEntries(
    recommendationHosts.map((host) => [
      host,
      buildTopRecommendationsForHost(
        host,
        candidateBases,
        demandContext,
        policy,
      ),
    ]),
  ) as Record<RecommendationHost, RecommendationEntry[]>;
  const hostSummaries = Object.fromEntries(
    recommendationHosts.map((host) => [
      host,
      buildHostSummary(host, topByHost[host], policy),
    ]),
  ) as Record<RecommendationHost, RecommendationHostSummary>;
  const suggestedBundles = recommendationHosts.map((host) =>
    buildSuggestedBundle(host, topByHost[host], policy),
  );

  // Build a deduplicated globally-ranked flat list. When the same asset
  // surfaces in multiple host lists, keep the entry with the highest score.
  const bestByAssetId = new Map<string, RecommendationEntry>();
  for (const entries of Object.values(topByHost)) {
    for (const entry of entries) {
      const existing = bestByAssetId.get(entry.assetId);
      if (existing === undefined || entry.score > existing.score) {
        bestByAssetId.set(entry.assetId, entry);
      }
    }
  }
  const recommendations = [...bestByAssetId.values()]
    .sort(
      (a, b) =>
        // Primary: descending score
        b.score - a.score ||
        // Stable tie-breaker: ascending assetId so ordering is deterministic
        // across Map insertion order differences (host iteration order varies).
        a.assetId.localeCompare(b.assetId),
    )
    // Assign a global rank reflecting position in the deduplicated sorted list.
    // Consumers should use this rather than entry.rank, which is the per-host rank.
    .map((entry, index) => ({ ...entry, globalRank: index + 1 }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: policy.schemaVersion,
    sessionIntent: primaryIntent,
    ...(resolvedIntents.length > 1
      ? { sessionIntents: [...resolvedIntents] }
      : {}),
    recommendations,
    topByHost,
    hostSummaries,
    suggestedBundles,
  };
}

function resolveSessionIntents(
  sessionIntents?: SessionIntent | readonly SessionIntent[],
): readonly SessionIntent[] {
  if (sessionIntents === undefined) {
    return ["general"];
  }

  if (typeof sessionIntents === "string") {
    return [sessionIntents];
  }

  return sessionIntents.length > 0 ? sessionIntents : ["general"];
}
