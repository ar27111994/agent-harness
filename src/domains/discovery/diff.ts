import { join } from "node:path";

import { CliUsageError } from "../../cli-help-format.js";
import {
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
} from "../../files.js";
import {
  assertAssetCatalogEntry,
  assertSelectionReport,
  assertSourceIndex,
} from "../../manifest-validation.js";
import type {
  AssetCatalogEntry,
  DiscoverDiffReport,
  LifecycleDiffBucket,
  SelectionReport,
  SourceIndex,
} from "../../types.js";
import {
  CATALOG_OUTPUT_PATH,
  DISCOVER_DIFF_OUTPUT_PATH,
  SELECTED_CATALOG_OUTPUT_PATH,
  SELECTION_REPORT_OUTPUT_PATH,
  SOURCE_INDEX_OUTPUT_PATH,
} from "./output-paths.js";

/**
 * Writes a discovery diff report comparing current outputs to a baseline root.
 */
export async function writeDiscoverDiffReport(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const baselineRoot = getRequiredOptionValue(args, "--baseline");
  const json = args.includes("--json");
  const report = await buildDiscoverDiffReport({
    baselineRoot,
    currentRoot: projectRoot,
  });

  await writeJsonFile(join(projectRoot, ...DISCOVER_DIFF_OUTPUT_PATH), report);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printDiscoverDiffReport(report);
}

/**
 * Builds a discovery diff report comparing two state roots.
 */
export async function buildDiscoverDiffReport(input: {
  baselineRoot: string;
  currentRoot: string;
}): Promise<DiscoverDiffReport> {
  const [baselineSourceIndex, currentSourceIndex] = await Promise.all([
    readJsonFile<SourceIndex>(
      join(input.baselineRoot, ...SOURCE_INDEX_OUTPUT_PATH),
      assertSourceIndex,
    ),
    readJsonFile<SourceIndex>(
      join(input.currentRoot, ...SOURCE_INDEX_OUTPUT_PATH),
      assertSourceIndex,
    ),
  ]);
  const [baselineCatalog, currentCatalog] = await Promise.all([
    readJsonLinesFile<AssetCatalogEntry>(
      join(input.baselineRoot, ...CATALOG_OUTPUT_PATH),
      assertAssetCatalogEntry,
    ),
    readJsonLinesFile<AssetCatalogEntry>(
      join(input.currentRoot, ...CATALOG_OUTPUT_PATH),
      assertAssetCatalogEntry,
    ),
  ]);
  const [baselineSelected, currentSelected] = await Promise.all([
    readJsonLinesFile<AssetCatalogEntry>(
      join(input.baselineRoot, ...SELECTED_CATALOG_OUTPUT_PATH),
      assertAssetCatalogEntry,
    ),
    readJsonLinesFile<AssetCatalogEntry>(
      join(input.currentRoot, ...SELECTED_CATALOG_OUTPUT_PATH),
      assertAssetCatalogEntry,
    ),
  ]);
  const [baselineSelectionReport, currentSelectionReport] = await Promise.all([
    readJsonFile<SelectionReport>(
      join(input.baselineRoot, ...SELECTION_REPORT_OUTPUT_PATH),
      assertSelectionReport,
    ),
    readJsonFile<SelectionReport>(
      join(input.currentRoot, ...SELECTION_REPORT_OUTPUT_PATH),
      assertSelectionReport,
    ),
  ]);
  const sources = diffRecords(
    new Map(
      baselineSourceIndex.enabledSources.map((source) => [
        source.id,
        summarizeSource(source),
      ]),
    ),
    new Map(
      currentSourceIndex.enabledSources.map((source) => [
        source.id,
        summarizeSource(source),
      ]),
    ),
  );
  const catalog = diffRecords(
    new Map(
      baselineCatalog.map((entry) => [entry.id, summarizeCatalog(entry)]),
    ),
    new Map(currentCatalog.map((entry) => [entry.id, summarizeCatalog(entry)])),
  );
  const selection = diffRecords(
    new Map(
      baselineSelected.map((entry) => [entry.id, summarizeCatalog(entry)]),
    ),
    new Map(
      currentSelected.map((entry) => [entry.id, summarizeCatalog(entry)]),
    ),
  );
  const lifecycleImpact = await buildLifecycleImpact({
    currentRoot: input.currentRoot,
    selection,
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baselineLabel: normalizeSerializedPathLabel(input.baselineRoot),
    currentLabel: normalizeSerializedPathLabel(input.currentRoot),
    sources,
    catalog,
    selection,
    counts: {
      sources: {
        baseline: baselineSourceIndex.sourceCount,
        current: currentSourceIndex.sourceCount,
      },
      catalog: {
        baseline: baselineCatalog.length,
        current: currentCatalog.length,
      },
      selected: {
        baseline: baselineSelectionReport.selectedCount,
        current: currentSelectionReport.selectedCount,
      },
      rejected: {
        baseline: baselineSelectionReport.rejectedCount,
        current: currentSelectionReport.rejectedCount,
      },
    },
    highImpactChanges: buildHighImpactChanges({
      sources,
      catalog,
      selection,
      lifecycleImpact,
    }),
  };
}

/**
 * Keeps serialized state-root labels stable across POSIX and Windows hosts.
 * These labels are display metadata, so lexical separator normalization is
 * sufficient and does not change the filesystem paths used above.
 */
export function normalizeSerializedPathLabel(pathLabel: string): string {
  return pathLabel.replaceAll("\\", "/");
}

function getRequiredOptionValue(args: string[], optionName: string): string {
  const optionIndex = args.indexOf(optionName);
  const value = optionIndex === -1 ? undefined : args[optionIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new CliUsageError(
      `discover diff requires ${optionName} <stateRoot>`,
      "agent-harness discover diff --help",
    );
  }

  return value;
}

function diffRecords(
  baseline: Map<string, string>,
  current: Map<string, string>,
): LifecycleDiffBucket {
  const added = [...current.keys()].filter((key) => !baseline.has(key)).sort();
  const removed = [...baseline.keys()]
    .filter((key) => !current.has(key))
    .sort();
  const changed = [...current.entries()]
    .filter(([key, value]) => baseline.has(key) && baseline.get(key) !== value)
    .map(([key]) => key)
    .sort();

  return { added, removed, changed };
}

function summarizeSource(
  source: SourceIndex["enabledSources"][number],
): string {
  return JSON.stringify({
    kind: source.kind,
    authorityTier: source.authorityTier,
    priority: source.priority,
    hosts: [...source.hosts].sort(),
    coverageMode: source.coverageMode,
    syncStatus: source.syncStatus,
    indexedEntryCount: source.indexedEntryCount,
  });
}

function summarizeCatalog(entry: AssetCatalogEntry): string {
  return JSON.stringify({
    assetKind: entry.assetKind,
    hosts: [...entry.hosts].sort(),
    compatibilityMode: entry.compatibilityMode,
    sourceId: entry.source.sourceId,
    authorityTier: entry.source.authorityTier,
    mirrorEligible: entry.status.mirrorEligible,
    installEligible: entry.status.installEligible,
    activationEligible: entry.status.activationEligible,
  });
}

async function buildLifecycleImpact(input: {
  currentRoot: string;
  selection: LifecycleDiffBucket;
}): Promise<string[]> {
  const changedAssetIds = [
    ...input.selection.added,
    ...input.selection.removed,
    ...input.selection.changed,
  ];
  if (changedAssetIds.length === 0) {
    return [];
  }

  const recommendationReport = await readJsonFileOrNull<{
    suggestedBundles?: Array<{ bundleId?: unknown; assetIds?: unknown }>;
  }>(join(input.currentRoot, "state", "recommendations.json"));
  if (!recommendationReport?.suggestedBundles) {
    return [];
  }

  const impactedBundles = recommendationReport.suggestedBundles
    .filter(
      (bundle) =>
        Array.isArray(bundle.assetIds) &&
        bundle.assetIds.some(
          (assetId) =>
            typeof assetId === "string" && changedAssetIds.includes(assetId),
        ),
    )
    .flatMap((bundle) =>
      typeof bundle.bundleId === "string" ? [bundle.bundleId] : [],
    )
    .sort((left, right) => left.localeCompare(right));

  return [...new Set(impactedBundles)].map(
    (bundleId) => `suggested bundle impacted: ${bundleId}`,
  );
}

function buildHighImpactChanges(input: {
  sources: LifecycleDiffBucket;
  catalog: LifecycleDiffBucket;
  selection: LifecycleDiffBucket;
  lifecycleImpact: string[];
}): string[] {
  const changes: string[] = [];
  for (const assetId of input.selection.added) {
    changes.push(`selected asset added: ${assetId}`);
  }
  for (const assetId of input.selection.removed) {
    changes.push(`selected asset removed: ${assetId}`);
  }
  for (const assetId of input.selection.changed) {
    changes.push(`selected asset changed: ${assetId}`);
  }
  for (const sourceId of input.sources.added) {
    changes.push(`source added: ${sourceId}`);
  }
  for (const sourceId of input.sources.removed) {
    changes.push(`source removed: ${sourceId}`);
  }
  changes.push(...input.lifecycleImpact);
  if (changes.length === 0 && input.catalog.changed.length > 0) {
    changes.push(
      `catalog metadata changed for ${input.catalog.changed.length} asset(s)`,
    );
  }

  return changes;
}

function printDiscoverDiffReport(report: DiscoverDiffReport): void {
  console.log("Discover diff: baseline -> current");
  console.log(
    `  Sources: ${report.counts.sources.baseline} -> ${report.counts.sources.current}`,
  );
  console.log(`    Added: ${formatList(report.sources.added)}`);
  console.log(`    Removed: ${formatList(report.sources.removed)}`);
  console.log(`    Changed: ${formatList(report.sources.changed)}`);
  console.log(
    `  Catalog assets: ${report.counts.catalog.baseline} -> ${report.counts.catalog.current}`,
  );
  console.log(`    Added: ${formatList(report.catalog.added)}`);
  console.log(`    Removed: ${formatList(report.catalog.removed)}`);
  console.log(`    Changed: ${formatList(report.catalog.changed)}`);
  console.log(
    `  Selected assets: ${report.counts.selected.baseline} -> ${report.counts.selected.current}`,
  );
  console.log(`    Added: ${formatList(report.selection.added)}`);
  console.log(`    Removed: ${formatList(report.selection.removed)}`);
  console.log(`    Changed: ${formatList(report.selection.changed)}`);
  console.log(`  High-impact changes: ${formatList(report.highImpactChanges)}`);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
