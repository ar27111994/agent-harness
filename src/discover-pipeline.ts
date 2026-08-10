/**
 * discover-pipeline — pipeline orchestration and reporting helpers for the
 * discover command group (#434).
 *
 * Extracted from discover.ts: breadth assessment, semantic demand-relevance
 * filtering, and demand-relevant source selection. Pure helpers only — the
 * CLI dispatch stays in discover.ts.
 */

import type { getRuntimeConfig } from "./config/runtime.js";
import { loadSourceRegistry } from "./domains/discovery/source-registry.js";
import { filterCatalogEntriesByDemandRelevance } from "./domains/discovery/catalog-selection.js";
import {
  harvestLocalDirectorySource,
  harvestLocalManifestSource,
} from "./domains/discovery/local-harvesters.js";
import { harvestPackageRegistrySource } from "./domains/discovery/package-registry-harvester.js";
import { harvestReferenceSource } from "./domains/discovery/reference-source-harvester.js";
import {
  buildDemandQueryText,
  SemanticScorer,
} from "./domains/discovery/semantic-scoring.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionRegistry,
  SelectionReport,
  SourceDefinition,
  SourceIndex,
} from "./types.js";

/**
 * Exhaustiveness guard for a closed SourceKind union: when a new kind is
 * added, this call fails to compile until the dispatch switch handles it.
 * At runtime an unknown kind is a programming error (the source-registry
 * validator closes the kind set), so the throw is the fail-loud contract.
 */
function assertNeverSourceKind(value: never): never {
  throw new Error(
    `Unhandled source kind ${JSON.stringify(value)} in catalog generation`,
  );
}

/**
 * Harvests the catalog entries for one non-repo source. Repo sources run
 * through a separate bounded batch loop in discover.ts; every other
 * SourceKind member is dispatched here (exhaustiveness-checked).
 *
 * ard-registry sources are indexed (cursor-based) coverage: when sync has
 * not populated the index yet, there is nothing to harvest locally. This is
 * a live state (an enabled ard source before its first sync), not an
 * invariant violation — surface it instead of failing or skipping silently.
 */
export async function harvestCatalogSourceEntries(
  source: SourceDefinition,
  sourceKind: Exclude<SourceDefinition["kind"], "repo">,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  switch (sourceKind) {
    case "local-manifest":
      return harvestLocalManifestSource(
        source,
        demandProfile,
        selectionRegistry,
        projectRoot,
      );
    case "local-directory":
      return harvestLocalDirectorySource(
        source,
        demandProfile,
        selectionRegistry,
        projectRoot,
      );
    case "package-registry":
      return harvestPackageRegistrySource(
        source,
        demandProfile,
        selectionRegistry,
      );
    case "docs":
    case "marketplace":
    case "registry":
      return harvestReferenceSource(source, demandProfile, selectionRegistry);
    case "ard-registry":
      process.stderr.write(
        `[discover catalog] ${source.id} (ard-registry) has no indexed entries yet — run discover sync to populate it.\n`,
      );
      return [];
    default:
      return assertNeverSourceKind(sourceKind);
  }
}

/**
 * Builds the stratified rejection sample: one representative per distinct
 * rejection reason (Pass 1), then tops up to `sampleSize` with the earliest
 * un-sampled entries (Pass 2). Membership checks use object references so
 * they stay O(1).
 *
 * The Pass-1 cap bounds the sample when the distinct-reason count exceeds
 * `sampleSize` — today the reason vocabulary is closed (3 kinds), but the
 * guard protects future rejection kinds and is exercised directly by tests
 * with >sampleSize distinct reasons.
 */
export function buildStratifiedRejectionSample<T extends { reason: string }>(
  rejectionLog: T[],
  sampleSize: number,
): T[] {
  const sample: T[] = [];
  const seenReasons = new Set<string>();
  for (const entry of rejectionLog) {
    if (sample.length >= sampleSize) break;
    if (!seenReasons.has(entry.reason)) {
      seenReasons.add(entry.reason);
      sample.push(entry);
    }
  }
  const sampledSet = new Set(sample);
  for (const entry of rejectionLog) {
    if (sample.length >= sampleSize) break;
    if (!sampledSet.has(entry)) {
      sample.push(entry);
      sampledSet.add(entry);
    }
  }
  return sample;
}

/**
 * Summarizes and assesses a breadth discovery pass: prints the demand-signal
 * count, indexed source count, operational source count, and the bottleneck
 * assessment with next steps. When `previousCatalogEntryCount` is provided
 * the catalog line also reports how the pool changed versus the prior pass.
 */
export function printDiscoveryBreadthSummary(input: {
  demandProfile: DemandProfile;
  sourceIndex: SourceIndex;
  enabledSources: SourceDefinition[];
  catalogEntries: AssetCatalogEntry[];
  selectionReport: SelectionReport;
  previousCatalogEntryCount?: number | null;
}): void {
  const demandSignalCount = countDemandSignals(input.demandProfile);
  const indexedSourceCount = input.sourceIndex.enabledSources.filter(
    (source) => source.coverageMode === "indexed",
  ).length;
  const operationalSourceCount = countOperationalSources(input.catalogEntries);
  const assessment = assessDiscoveryBreadth({
    demandProfile: input.demandProfile,
    catalogEntries: input.catalogEntries,
    operationalSourceCount,
    selectionReport: input.selectionReport,
    sourceCount: input.enabledSources.length,
  });

  console.log("Discovery breadth complete.");
  console.log(`Assessment: ${assessment.kind}`);
  console.log(`Reason: ${assessment.reason}`);
  console.log(
    `Signals: ${demandSignalCount} across ${input.demandProfile.evidence.length} evidence file(s)`,
  );
  console.log(
    `Sources: ${input.sourceIndex.sourceCount} enabled (${indexedSourceCount} indexed, ${operationalSourceCount} operational)`,
  );
  console.log(
    `Selection: ${input.catalogEntries.length} catalog entries -> ${input.selectionReport.selectedCount} selected / ${input.selectionReport.rejectedCount} rejected` +
      (input.previousCatalogEntryCount === null ||
      input.previousCatalogEntryCount === undefined
        ? ""
        : ` (previous pass: ${input.previousCatalogEntryCount})`),
  );
  console.log("Next steps:");
  for (const nextStep of assessment.nextSteps) {
    console.log(`- ${nextStep}`);
  }
}

function countDemandSignals(demandProfile: DemandProfile): number {
  return new Set([
    ...demandProfile.signals.languages,
    ...demandProfile.signals.packageManagers,
    ...demandProfile.signals.frameworks,
    ...demandProfile.signals.concerns,
    ...demandProfile.signals.tooling,
  ]).size;
}

function countOperationalSources(catalogEntries: AssetCatalogEntry[]): number {
  const operationalSourceIds = new Set<string>();

  for (const entry of catalogEntries) {
    if (
      entry.evidence.manifestFound ||
      entry.status.mirrorEligible ||
      entry.status.installEligible ||
      entry.status.activationEligible
    ) {
      operationalSourceIds.add(entry.source.sourceId);
    }
  }

  return operationalSourceIds.size;
}

function assessDiscoveryBreadth(input: {
  demandProfile: DemandProfile;
  sourceCount: number;
  operationalSourceCount: number;
  catalogEntries: AssetCatalogEntry[];
  selectionReport: SelectionReport;
}): {
  kind:
    | "detection-limited"
    | "source-coverage-limited"
    | "selection-limited"
    | "ranking-ready";
  reason: string;
  nextSteps: string[];
} {
  const demandSignalCount = countDemandSignals(input.demandProfile);

  if (input.demandProfile.evidence.length === 0 || demandSignalCount === 0) {
    return {
      kind: "detection-limited",
      reason:
        "The demand profile is too sparse to trust candidate-pool breadth yet.",
      nextSteps: [
        "Confirm you are running from the real workspace root.",
        "Inspect discover/output/demand-profile.json and verify real manifests are visible.",
        "Check .gitignore, .ignore, and .agent-harnessignore for accidentally hidden manifests.",
      ],
    };
  }

  if (
    input.sourceCount === 0 ||
    input.catalogEntries.length === 0 ||
    input.operationalSourceCount === 0
  ) {
    return {
      kind: "source-coverage-limited",
      reason:
        "The active discovery universe is not producing a broad operational catalog yet.",
      nextSteps: [
        "Inspect discover/output/source-index.json and discover/output/source-utilization.json.",
        "If the checked-in source universe is still too narrow, widen the active state-root discovery inputs: discover/sources.json, discover/source-packs/*.json, discover/official-skills-indexes.json, and discover/official-upstreams.json.",
        "Rerun 'agent-harness discover breadth' after changing the active state-root discovery inputs.",
      ],
    };
  }

  if (
    input.selectionReport.selectedCount === 0 ||
    (input.catalogEntries.length >= 25 &&
      input.selectionReport.selectedCount <=
        Math.max(3, Math.floor(input.catalogEntries.length * 0.05)))
  ) {
    return {
      kind: "selection-limited",
      reason:
        "Discovery is producing candidates, but the selected set is still narrow enough that selection filtering may be the bottleneck.",
      nextSteps: [
        "Inspect discover/output/selection-report.json plus catalog.selected.jsonl and catalog.rejected.jsonl.",
        "Only change recommendation policy after confirming the right assets are missing from the selected set.",
        "If the selected set already contains the right assets, the next step is ranking rather than more breadth.",
      ],
    };
  }

  return {
    kind: "ranking-ready",
    reason:
      "The candidate pool looks broad enough to judge recommendation quality instead of recall first.",
    nextSteps: [
      "Run 'agent-harness recommend report' next.",
      "If the final ordering still feels wrong, inspect 'agent-harness recommend explain --host <host> --asset <asset-id>' and 'agent-harness recommend policy:print --host <host>'.",
      "Use the recommendation policy playbook only after confirming that breadth/selection are not the bottleneck.",
    ],
  };
}

/**
 * Prints help for a specific discover subcommand.
 */

/**
 * Applies demand-relevance filtering to the catalog, using semantic similarity
 * scoring when enabled and available, falling back to keyword-overlap gating.
 *
 * All scorer branching lives here so `generateSelectionOutputs` stays clean.
 */

/**
 * Minimal shape the semantic relevance filter needs from a scorer, so tests
 * can inject a stub without loading the optional transformers pipeline.
 */
export interface RelevanceScorer {
  readonly available: boolean;
  tryInit(): Promise<void>;
  filterAndRank(
    entries: AssetCatalogEntry[],
    demandProfile: DemandProfile | null,
  ): Promise<{
    selected: AssetCatalogEntry[];
    rejected: AssetCatalogEntry[];
  } | null>;
}

/**
 * Applies the semantic relevance filter when enabled, falling back to the
 * keyword demand-relevance gate otherwise. All scorer branching lives here
 * so `generateSelectionOutputs` stays clean.
 */
export async function applyRelevanceFilter(
  catalogEntries: AssetCatalogEntry[],
  demandProfile: DemandProfile | null,
  config: ReturnType<typeof getRuntimeConfig>,
  scorerFactory: (minSimilarity: number) => RelevanceScorer = (minSimilarity) =>
    new SemanticScorer({ minSimilarity }),
): Promise<{
  selectedEntries: AssetCatalogEntry[];
  rejectedEntries: AssetCatalogEntry[];
}> {
  if (config.discovery.semanticScoringEnabled) {
    const scorer = scorerFactory(config.discovery.semanticScoringMinSimilarity);
    await scorer.tryInit();
    if (scorer.available) {
      const semanticResult = await scorer.filterAndRank(
        catalogEntries,
        demandProfile,
      );
      if (semanticResult) {
        console.log(
          `[semantic-scoring] scored ${catalogEntries.length} entries ` +
            `(threshold=${config.discovery.semanticScoringMinSimilarity}, ` +
            `query="${buildDemandQueryText(demandProfile).slice(0, 60)}...")`,
        );
        return {
          selectedEntries: semanticResult.selected,
          rejectedEntries: semanticResult.rejected,
        };
      }
      console.warn(
        "[semantic-scoring] scorer unavailable after init — falling back to keyword gate",
      );
    } else {
      console.warn(
        "[semantic-scoring] @xenova/transformers not installed — falling back to keyword gate",
      );
    }
  }
  return filterCatalogEntriesByDemandRelevance(catalogEntries, demandProfile);
}

/**
 * Applies a per-source entry cap to a pre-sorted list of catalog entries.
 *
 * Entries are visited in the order provided; the first `maxPerSource` entries
 * for each `source.sourceId` are kept, and any excess are returned in the
 * `capped` array so callers can add rejection-log entries.
 *
 * @param entries - Pre-sorted selected entries (insertion order preserved).
 * @param maxPerSource - Maximum entries to retain per unique `source.sourceId`.
 * @returns `{ kept, capped }` — kept entries in original order; capped entries
 *   as `{ assetId }` objects suitable for rejection logging.
 */
export function applyPerSourceCap(
  entries: AssetCatalogEntry[],
  maxPerSource: number,
): { kept: AssetCatalogEntry[]; capped: Array<{ assetId: string }> } {
  const sourceCountMap = new Map<string, number>();
  const kept: AssetCatalogEntry[] = [];
  const capped: Array<{ assetId: string }> = [];
  for (const entry of entries) {
    const sourceId = entry.source.sourceId;
    const count = sourceCountMap.get(sourceId) ?? 0;
    // 0 means unlimited — skip the cap check entirely.
    if (maxPerSource > 0 && count >= maxPerSource) {
      capped.push({ assetId: entry.id });
    } else {
      sourceCountMap.set(sourceId, count + 1);
      kept.push(entry);
    }
  }
  return { kept, capped };
}

/** Threshold fraction above which a source triggers a diversity warning. */
const SOURCE_DIVERSITY_WARNING_THRESHOLD = 0.2;

/**
 * Maximum number of sample rejected entries in SelectionReport.sampleRejected.
 * Guarantees at least one entry per distinct rejection reason.
 */
export const REJECTION_SAMPLE_SIZE = 20;

/**
 * Returns a human-readable warning when any single source contributes more
 * than 20% of the provided (already-capped) selected entries.  Returns
 * `undefined` when the set is well-diversified or empty.
 *
 * @param cappedEntries - Selected entries after the per-source cap.
 * @param maxPerSource - The cap value in effect, included in the message so
 *   the operator knows which knob to turn.
 */
export function computeSourceDiversityWarning(
  cappedEntries: AssetCatalogEntry[],
  maxPerSource: number,
): string | undefined {
  if (cappedEntries.length === 0) {
    return undefined;
  }
  const sourceCounts = new Map<string, number>();
  for (const entry of cappedEntries) {
    const id = entry.source.sourceId;
    sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
  }
  for (const [sourceId, count] of sourceCounts.entries()) {
    const fraction = count / cappedEntries.length;
    if (fraction > SOURCE_DIVERSITY_WARNING_THRESHOLD) {
      const pct = Math.round(fraction * 100);
      return (
        `Source "${sourceId}" contributes ${pct}% of selected entries ` +
        `(${count}/${cappedEntries.length}). ` +
        `Consider lowering AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE ` +
        `(currently ${maxPerSource}) to improve diversity.`
      );
    }
  }
  return undefined;
}

/**
 * Computes the acceptance rate as a fraction 0–1.
 * Returns 0 when inputCount is 0 to avoid division by zero.
 * Rounded to 4 decimal places for diagnostic use.
 */
export function computeAcceptanceRate(
  inputCount: number,
  selectedCount: number,
): number {
  if (inputCount === 0) {
    return 0;
  }
  return Number((selectedCount / inputCount).toFixed(4));
}

/**
 * Exposes narrow discover internals for focused per-source-cap tests.
 */

const UNIVERSAL_SOURCE_IDS = new Set([
  "mcp-registry",
  "skills-sh",
  "ui-skills",
  "clawhub",
]);

/**
 * Maps demand profile technology signals to source IDs that should be synced.
 * Sources not in the returned set are skipped during sync unless --sync-all is
 * passed (#419 — demand-based source filtering for faster first-run sync).
 */
export function computeDemandRelevantSourceIds(
  demandProfile: DemandProfile,
): ReadonlySet<string> {
  const sourceIds = new Set<string>(UNIVERSAL_SOURCE_IDS);
  const signals = demandProfile.signals;

  // Languages → registry sources
  const languageSignals = new Set(
    signals.languages.map((lang) => lang.toLowerCase()),
  );
  // Frameworks, package managers, and tooling also indicate ecosystem.
  // Normalize to lowercase for case-insensitive matching.
  const ecosystemTerms = new Set([
    ...signals.frameworks.map((fw) => fw.toLowerCase()),
    ...signals.packageManagers.map((pm) => pm.toLowerCase()),
    ...signals.tooling.map((t) => t.toLowerCase()),
  ]);

  // ── JavaScript / TypeScript ecosystem ──
  // npm, yarn (classic/berry), pnpm, bun, deno, node, tsx, ts-node, vite,
  // webpack, esbuild, turbopack, nx, lerna, turbo, rush, etc.
  if (
    languageSignals.has("typescript") ||
    languageSignals.has("javascript") ||
    ecosystemTerms.has("npm") ||
    ecosystemTerms.has("yarn") ||
    ecosystemTerms.has("pnpm") ||
    ecosystemTerms.has("bun") ||
    ecosystemTerms.has("deno") ||
    ecosystemTerms.has("node") ||
    ecosystemTerms.has("node.js")
  ) {
    sourceIds.add("npm-registry");
  }

  // ── Python ecosystem ──
  // pip, poetry, uv, pdm, pipenv, conda, rye, hatch
  if (
    languageSignals.has("python") ||
    ecosystemTerms.has("pip") ||
    ecosystemTerms.has("poetry") ||
    ecosystemTerms.has("uv") ||
    ecosystemTerms.has("pdm") ||
    ecosystemTerms.has("pipenv") ||
    ecosystemTerms.has("conda") ||
    ecosystemTerms.has("rye") ||
    ecosystemTerms.has("hatch")
  ) {
    sourceIds.add("pypi-registry");
  }

  // ── Rust ecosystem ──
  // cargo, rustup, rust-analyzer
  if (languageSignals.has("rust") || ecosystemTerms.has("cargo")) {
    sourceIds.add("cargo-registry");
  }

  // ── Java / Kotlin / Scala ecosystem ──
  // maven, gradle, sbt, ant, leiningen
  if (
    languageSignals.has("java") ||
    languageSignals.has("kotlin") ||
    languageSignals.has("scala") ||
    ecosystemTerms.has("maven") ||
    ecosystemTerms.has("gradle") ||
    ecosystemTerms.has("sbt") ||
    ecosystemTerms.has("ant")
  ) {
    sourceIds.add("maven-registry");
  }

  // ── .NET ecosystem ──
  // nuget, dotnet, msbuild, paket
  if (
    languageSignals.has("c#") ||
    languageSignals.has("csharp") ||
    languageSignals.has("f#") ||
    languageSignals.has("fsharp") ||
    ecosystemTerms.has("nuget") ||
    ecosystemTerms.has("dotnet")
  ) {
    sourceIds.add("nuget-registry");
  }

  // ── Go ecosystem ──
  if (languageSignals.has("go") || languageSignals.has("golang")) {
    sourceIds.add("go-registry");
  }

  // ── PHP ecosystem ──
  // composer, laravel, symfony
  if (
    languageSignals.has("php") ||
    ecosystemTerms.has("composer") ||
    ecosystemTerms.has("laravel") ||
    ecosystemTerms.has("symfony")
  ) {
    sourceIds.add("packagist-registry");
  }

  // ── Ruby ecosystem ──
  // gem, bundler, rails, rbenv, rvm
  if (
    languageSignals.has("ruby") ||
    ecosystemTerms.has("gem") ||
    ecosystemTerms.has("bundler") ||
    ecosystemTerms.has("rails") ||
    ecosystemTerms.has("rbenv") ||
    ecosystemTerms.has("rvm")
  ) {
    sourceIds.add("rubygems-registry");
  }

  // ── Swift ecosystem ──
  // swiftpm, xcode
  if (
    languageSignals.has("swift") ||
    ecosystemTerms.has("swiftpm") ||
    ecosystemTerms.has("xcode")
  ) {
    sourceIds.add("swift-package-index");
  }

  // ── VS Code ecosystem ──
  if (
    ecosystemTerms.has("vscode") ||
    ecosystemTerms.has("vs code") ||
    ecosystemTerms.has("visual studio code") ||
    ecosystemTerms.has("detector:codepilot") ||
    ecosystemTerms.has("detector:vscode")
  ) {
    sourceIds.add("vscode-marketplace");
  }

  // ── Cursor ecosystem ──
  if (ecosystemTerms.has("cursor") || ecosystemTerms.has("detector:cursor")) {
    sourceIds.add("cursor-marketplace");
  }

  // ── Pi agent ecosystem ──
  if (
    ecosystemTerms.has("pi") ||
    ecosystemTerms.has("detector:pi") ||
    signals.concerns.some((c) =>
      ["pi-agent", "pi-skill"].includes(c.toLowerCase()),
    )
  ) {
    sourceIds.add("pi-packages");
  }

  // ── Zed ecosystem ──
  if (ecosystemTerms.has("zed") || ecosystemTerms.has("detector:zed")) {
    sourceIds.add("zed-extension-registry");
  }

  // ── Dart / Flutter ecosystem ──
  if (
    languageSignals.has("dart") ||
    ecosystemTerms.has("flutter") ||
    ecosystemTerms.has("pub")
  ) {
    sourceIds.add("pub-dev-registry");
  }

  // ── Elixir / Erlang ecosystem ──
  if (
    languageSignals.has("elixir") ||
    languageSignals.has("erlang") ||
    ecosystemTerms.has("mix") ||
    ecosystemTerms.has("hex") ||
    ecosystemTerms.has("rebar")
  ) {
    sourceIds.add("hex-registry");
  }

  // ── C / C++ ecosystem ──
  if (
    languageSignals.has("c") ||
    languageSignals.has("c++") ||
    languageSignals.has("cpp") ||
    ecosystemTerms.has("cmake") ||
    ecosystemTerms.has("meson") ||
    ecosystemTerms.has("conan")
  ) {
    sourceIds.add("conan-registry");
  }

  // Always include local sources (project-specific)
  sourceIds.add("local-antigravity-manifest");

  return sourceIds;
}

/**
 * Returns the IDs of all enabled sources in the source registry.
 * Used to compute accurate filtered/skipped counts for the demand-based
 * filtering progress hint (#419).
 */
export async function getEnabledSourceIds(
  projectRoot: string,
): Promise<string[]> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  return sourceRegistry.sources
    .filter((source) => source.enabled)
    .map((source) => source.id);
}
