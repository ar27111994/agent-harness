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
import type { RecommendationHost } from "./hosts.js";

/**
 * Writes recommendation report to project state.
 */
export async function writeRecommendationReport(
  projectRoot: string,
  options: {
    policy?: RecommendationPolicy;
    sessionIntent?: SessionIntent;
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
  const report = buildRecommendationReport(
    selectedEntries,
    demandProfile,
    resolvedPolicy,
    options.sessionIntent ?? "general",
  );

  await writeJsonFile(join(projectRoot, ...REPORT_FILE_PATH), report);

  return report;
}

/**
 * Builds recommendation report from the provided inputs.
 */
export function buildRecommendationReport(
  entries: AssetCatalogEntry[],
  demandProfile: DemandProfile | null,
  policy: RecommendationPolicy,
  sessionIntent: SessionIntent = "general",
): RecommendationReport {
  const demandContext = buildDemandContext(
    demandProfile,
    policy,
    sessionIntent,
  );
  const recommendationHosts = getRecommendationHosts();
  const topByHost = Object.fromEntries(
    recommendationHosts.map((host) => [
      host,
      buildTopRecommendationsForHost(host, entries, demandContext, policy),
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

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: policy.schemaVersion,
    sessionIntent,
    topByHost,
    hostSummaries,
    suggestedBundles,
  };
}
