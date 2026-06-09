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
import { buildDemandContext } from "./signals.js";
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
 * Writes recommendation report to project state.
 */
export async function writeRecommendationReport(
  projectRoot: string,
  options: {
    policy?: RecommendationPolicy;
    sessionIntent?: SessionIntent;
    sessionIntents?: readonly SessionIntent[];
  } = {},
): Promise<RecommendationReport> {
  const resolvedPolicy =
    options.policy ?? (await loadRecommendationPolicy(projectRoot));
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    assertDemandProfile,
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
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
  const candidateBases = entries
    .filter((entry) => entry.compatibilityMode !== "incompatible")
    .map((entry) =>
      buildCandidateRecommendationBase(
        entry,
        demandContext,
        policy,
        policyContext,
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
