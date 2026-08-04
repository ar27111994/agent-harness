import { join } from "node:path";

import {
  readJsonFile,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import { assertMirrorPolicy } from "../manifest-validation.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  MirrorPlan,
  MirrorPolicy,
  SourceIndex,
} from "../types.js";
import { loadDiscoveryArtifacts } from "./discovery-artifacts.js";
import { MIRROR_PLAN_OUTPUT_PATH } from "./constants.js";

/**
 * Generates mirror plan artifacts for the lifecycle pipeline.
 */
export async function generateMirrorPlan(projectRoot: string): Promise<void> {
  const policy = await readJsonFile<MirrorPolicy>(
    join(projectRoot, "mirror", "policy.json"),
    assertMirrorPolicy,
  );
  // The remaining discovery inputs travel together as a family; load them
  // through the shared typed loader so every future reader reuses the same
  // paths, validators, and nullability semantics (#437).
  const { demandProfile, sourceIndex, catalogEntries, selectedEntries } =
    await loadDiscoveryArtifacts(projectRoot);
  const selectedCatalogEntries = selectedEntries.length;
  const mirrorEligibleEntries = catalogEntries.filter(
    (entry) => entry.status.mirrorEligible,
  );

  const nextActions = buildNextActions(
    demandProfile,
    sourceIndex,
    catalogEntries.length,
    mirrorEligibleEntries.length,
    selectedCatalogEntries,
  );

  const mirrorPlan: MirrorPlan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      demandProfile: demandProfile !== null,
      sourceIndex: sourceIndex !== null,
      catalogEntries: catalogEntries.length,
      mirrorEligibleEntries: mirrorEligibleEntries.length,
      selectedCatalogEntries,
    },
    candidateBreakdown: {
      byHost: countEntriesByHost(mirrorEligibleEntries),
      byAssetKind: countEntriesByAssetKind(mirrorEligibleEntries),
    },
    policies: {
      officialBeatsPopularity: policy.selection.officialBeatsPopularity,
      communityDefaultPolicy: policy.selection.communityDefaultPolicy,
      alwaysAudit: policy.audit.alwaysAudit,
    },
    bundleTemplates: policy.bundleTemplates,
    nextActions,
  };

  const outputPath = join(projectRoot, ...MIRROR_PLAN_OUTPUT_PATH);
  await writeJsonFile(outputPath, mirrorPlan);

  console.log(`Mirror plan written to ${toPosixPath(outputPath)}`);
}

function buildNextActions(
  demandProfile: DemandProfile | null,
  sourceIndex: SourceIndex | null,
  catalogEntries: number,
  mirrorEligibleEntries: number,
  selectedCatalogEntries: number,
): string[] {
  const nextActions: string[] = [];

  if (!demandProfile) {
    nextActions.push(
      "Run discover demand-profile to capture current-directory portfolio signals.",
    );
  }

  if (!sourceIndex) {
    nextActions.push(
      "Run discover sources to summarize enabled discovery sources.",
    );
  }

  if (catalogEntries === 0) {
    nextActions.push(
      "Run discover catalog to harvest local manifest and local directory sources into discover/catalog.assets.jsonl.",
    );
  }

  if (catalogEntries > 0 && mirrorEligibleEntries === 0) {
    nextActions.push(
      "Review catalog statuses and enable mirror eligibility only for approved local assets.",
    );
  }

  if (selectedCatalogEntries === 0) {
    nextActions.push(
      "Create discover/output/catalog.selected.jsonl after canonical selection and promotion rules are applied to catalog entries.",
    );
  }

  if (nextActions.length === 0) {
    nextActions.push(
      "Resolve exact artifact versions for canonical selected assets before writing mirror locks.",
    );
    nextActions.push(
      "Mirror only canonical or explicitly approved alternative assets into the inert mirror store.",
    );
  }

  return nextActions;
}

function countEntriesByHost(
  entries: AssetCatalogEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    for (const host of entry.hosts) {
      counts[host] = (counts[host] ?? 0) + 1;
    }
  }

  return counts;
}

function countEntriesByAssetKind(
  entries: AssetCatalogEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    counts[entry.assetKind] = (counts[entry.assetKind] ?? 0) + 1;
  }

  return counts;
}
