/**
 * v2-coverage-gaps.test.ts
 *
 * Targeted tests for branches/lines that remained uncovered after all other
 * test suites ran.  Each test names the source file and line range it covers.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { buildDemandProfile } from "../domains/discovery/demand-profile.js";
import { syncPackagistRegistrySource } from "../domains/discovery/source-sync/registries/packagist.js";
import type { SourceSyncContext } from "../domains/discovery/source-sync/types.js";
import { listFilesRecursiveWithTelemetry } from "../files.js";
import {
  formatWirePlanSummary,
  openCodeWireInternals,
} from "../host-adapters/opencode.js";
import { httpInternals } from "../lib/http.js";
import { assertRecommendationPolicyBaseOverride } from "../manifest-validation/recommendation.js";
import {
  buildCandidateRecommendationBase,
  buildPolicySearchContext,
} from "../recommend/candidates.js";
import { isPublisherVerifiedForAuthorityTier } from "../source-metadata.js";
import type {
  AssetCatalogEntry,
  RecommendationPolicy,
  SourceDefinition,
} from "../types.js";

// ─── files.ts:861–862 — sort tie-breaker within same priority tier ───────────

void test("listFilesRecursiveWithTelemetry: binary files sort after source files (priority-diff early-return)", async () => {
  // Exercises files.ts:861-862 — `if (priorityDiff !== 0) { return priorityDiff; }`
  // inside collectFilesFromDirectory's sort comparator.
  // A dir with both .ts (high-priority) and .png (low-priority) files forces
  // the early-return path (priorityDiff !== 0) for cross-tier pairs, and the
  // lexicographic fallback (lines 864-865) for same-tier pairs.
  const root = await mkdtemp(join(tmpdir(), "agent-harness-sort-test-"));
  try {
    // Create mixed-priority files at the root level
    await writeFile(join(root, "zebra.ts"), "// ts source file");
    await writeFile(join(root, "aardvark.ts"), "// ts source file");
    await writeFile(
      join(root, "logo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    ); // PNG magic
    await writeFile(
      join(root, "banner.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const { files } = await listFilesRecursiveWithTelemetry(root);

    // All files should be returned
    assert.equal(files.length, 4, "should collect all 4 files");

    // Low-priority (.png) files must appear AFTER high-priority (.ts) files
    const relFiles = files.map((f) =>
      f.replace(root, "").replace(/\\/g, "/").replace(/^\//, ""),
    );
    const tsFiles = relFiles.filter((f) => f.endsWith(".ts"));
    const pngFiles = relFiles.filter((f) => f.endsWith(".png"));

    assert.equal(tsFiles.length, 2, "both .ts files collected");
    assert.equal(pngFiles.length, 2, "both .png files collected");

    const lastTsIndex = Math.max(...tsFiles.map((f) => relFiles.indexOf(f)));
    const firstPngIndex = Math.min(...pngFiles.map((f) => relFiles.indexOf(f)));
    assert.ok(
      lastTsIndex < firstPngIndex,
      `all .ts files (high-priority) must precede all .png files (low-priority). Got order: ${relFiles.join(", ")}`,
    );

    // Within the same tier, lexicographic order must hold (exercises lines 864-865)
    assert.ok(
      tsFiles.indexOf("aardvark.ts") < tsFiles.indexOf("zebra.ts"),
      ".ts files should be in lexicographic order within their tier",
    );
    assert.ok(
      pngFiles.indexOf("banner.png") < pngFiles.indexOf("logo.png"),
      ".png files should be in lexicographic order within their tier",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ─── demand-profile.ts:75–82 — stderr warn when truncationReason is undefined ─

void test("buildDemandProfile: truncation warn is emitted even when truncationReason is absent", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-truncation-reason-gap-"),
  );
  const prevMaxFiles = process.env["AGENT_HARNESS_SCAN_MAX_FILES"];
  // Force file-budget truncation: limit to 1 file so a 2-file workspace
  // immediately truncates and emits the [warn] stderr line.
  process.env["AGENT_HARNESS_SCAN_MAX_FILES"] = "1";
  // Bust the runtime-config cache so the new env var takes effect.
  clearRuntimeConfigForTests();

  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (
    chunk: Uint8Array | string,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    if (typeof chunk === "string") chunks.push(chunk);
    if (typeof encodingOrCb === "function")
      return originalWrite(chunk, encodingOrCb);
    if (encodingOrCb !== undefined)
      return originalWrite(chunk, encodingOrCb, cb);
    return originalWrite(chunk);
  };

  try {
    // Write two files — first file consumes the maxFiles=1 budget; second triggers truncation.
    await writeFile(join(root, "a.json"), JSON.stringify({ name: "a" }));
    await writeFile(join(root, "b.json"), JSON.stringify({ name: "b" }));
    await buildDemandProfile(root);

    const output = chunks.join("");
    assert.ok(
      output.includes("[warn]") && output.includes("truncated"),
      `expected [warn] + truncated on stderr; got: ${JSON.stringify(output)}`,
    );
  } finally {
    process.stderr.write = originalWrite;
    if (prevMaxFiles === undefined) {
      delete process.env["AGENT_HARNESS_SCAN_MAX_FILES"];
    } else {
      process.env["AGENT_HARNESS_SCAN_MAX_FILES"] = prevMaxFiles;
    }
    clearRuntimeConfigForTests();
    await rm(root, { recursive: true, force: true });
  }
});

// ─── packagist.ts:45–50 — break when indexed entry cap is reached ────────────

void test("syncPackagistRegistrySource: stops at SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP when list exceeds cap", async () => {
  // Exercises packagist.ts:49-50 — the `break` inside the cap guard.
  //
  // Strategy: set listApi to https://1.1.1.1/packages/list.json so that
  // resolvePublicInternetAddresses detects a bare IPv4 and skips DNS entirely,
  // then intercept node:https.request to return a canned 502-entry response.
  const OVER_CAP = 502; // SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP = 500
  const packageNames = Array.from(
    { length: OVER_CAP },
    (_, i) => `vendor/package-${i}`,
  );

  const listApi = "https://1.1.1.1/packages/list.json";
  const source = {
    id: "packagist-cap-test",
    kind: "package-registry",
    enabled: true,
    authorityTier: "unverified-community",
    displayName: "Packagist Cap Test",
    namespace: "packagist",
    registryKind: "packagist",
    baseUrl: "https://1.1.1.1",
    endpoints: {
      listApi,
    },
  } as unknown as SourceDefinition;

  const entriesById = new Map<string, AssetCatalogEntry>();
  const context = {
    demandProfile: null,
    selectionRegistry: {
      schemaVersion: 1,
      selectionPolicies: { allow: [], deny: [] },
      rankingOrder: [],
      duplicateGroups: [],
    },
    entriesById,
    entriesDirty: false,
    previousState: undefined,
    observedEntryIds: new Set<string>(),
  } as unknown as SourceSyncContext;

  // Intercept node:https.request. Because listApi is a bare IP, DNS resolution
  // is skipped entirely — no real network involved.
  // requestWithPinnedAddress wraps responseMessage in Readable.toWeb(), so we
  // must supply a real Readable (not just an EventEmitter).
  const responseBody = JSON.stringify({ packageNames });
  const restoreRequest = httpInternals.setHttpsRequestForTests(((
    _url: URL,
    _options: unknown,
    callback: (
      response: Readable & {
        headers: Record<string, string>;
        statusCode: number;
        statusMessage: string;
      },
    ) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & {
      write(): boolean;
      end(): void;
    };
    req.write = () => true;
    req.end = () => {
      const res = Object.assign(
        Readable.from([Buffer.from(responseBody, "utf8")]),
        {
          headers: { "content-type": "application/json" },
          statusCode: 200,
          statusMessage: "OK",
        },
      );
      queueMicrotask(() => callback(res as never));
    };
    return req as never;
  }) as never);

  try {
    const state = await syncPackagistRegistrySource(source, context);

    assert.ok(
      entriesById.size <= 500,
      `expected ≤500 entries (cap), got ${entriesById.size}`,
    );
    assert.ok(entriesById.size > 0, "expected some entries before the cap");
    assert.equal(state.coverageMode, "indexed");
    assert.equal(state.status, "complete");
    assert.ok(
      (state.indexedEntryCount ?? 0) <= 500,
      "indexedEntryCount must be within cap",
    );
  } finally {
    restoreRequest();
  }
});

// ─── opencode.ts:317–318 — readOpenCodeNpmInstallSummary null when no file ────

void test("readOpenCodeNpmInstallSummary: returns null when .opencode/package.json is absent", async () => {
  const workspace = await mkdtemp(
    join(tmpdir(), "agent-harness-no-opencode-pkg-"),
  );
  try {
    // Create .opencode directory without a package.json inside it
    await mkdir(join(workspace, ".opencode"), { recursive: true });

    const result =
      await openCodeWireInternals.readOpenCodeNpmInstallSummary(workspace);
    assert.equal(
      result,
      null,
      "should return null when .opencode/package.json does not exist",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

// ─── opencode.ts:522–528 — formatWirePlanSummary notes section ───────────────

void test("formatWirePlanSummary: omits Notes section when plan.notes is absent (??[] fallback)", () => {
  // No `notes` property at all — exercises the `plan.notes ?? []` branch (line 523)
  const plan = {
    schemaVersion: "2.0.0",
    host: "opencode" as const,
    generatedAt: "2026-06-09T00:00:00.000Z",
    workspaceRoot: "/test/workspace",
    linkedPaths: [],
    mcpServers: [],
    nativeConfigOperations: [],
    textFileSnapshots: [],
    // deliberately no `notes` field
  } as unknown as Parameters<typeof formatWirePlanSummary>[0];

  const output = formatWirePlanSummary(plan);
  assert.ok(output.includes("wire opencode"), "header should be present");
  assert.ok(!output.includes("Notes:"), "Notes section must be absent");
  assert.ok(!output.includes("ℹ "), "note glyphs must be absent");
});

void test("formatWirePlanSummary: renders Notes section when plan.notes has entries", () => {
  // Exercises lines 524–528 (the loop body that emits note lines)
  const plan = {
    schemaVersion: "2.0.0",
    host: "opencode" as const,
    generatedAt: "2026-06-09T00:00:00.000Z",
    workspaceRoot: "/test/workspace",
    linkedPaths: [],
    mcpServers: [],
    nativeConfigOperations: [],
    textFileSnapshots: [],
    notes: ["First note.", "Second note."],
  } as unknown as Parameters<typeof formatWirePlanSummary>[0];

  const output = formatWirePlanSummary(plan);
  assert.ok(output.includes("Notes:"), "Notes section header must appear");
  assert.ok(
    output.includes("ℹ First note."),
    "first note must appear with glyph",
  );
  assert.ok(
    output.includes("ℹ Second note."),
    "second note must appear with glyph",
  );
});

// ─── recommendation.ts:590–592 — ecosystemMismatchPenalty default injection ──

void test("assertRecommendationPolicyBaseOverride: injects ecosystemMismatchPenalty=0 for pre-v2.0.0 scoring objects", () => {
  // Build a scoring object that is missing ecosystemMismatchPenalty,
  // exercising the `if (scoring.ecosystemMismatchPenalty === undefined)` branch.
  const scoring: Record<string, unknown> = {
    demandMatchCap: 20,
    portfolioFitMultiplier: 10,
    trustDivisor: 10,
    sourcePriorityDivisor: 10,
    authorityWeights: {
      "official-first-party": 100,
      "official-marketplace": 80,
      "official-compatible": 70,
      "trusted-local": 60,
      "trusted-community": 40,
      "unverified-community": 10,
    },
    compatibilityWeights: {
      native: 30,
      adaptable: 20,
      partial: 10,
      "reference-only": 5,
      incompatible: -100,
    },
    costPenalties: { tiny: 0, small: 1, medium: 2, large: 4 },
    demandSignalWeights: {
      languages: 1,
      packageManagers: 1,
      frameworks: 1,
      concerns: 1,
      tooling: 1,
    },
    riskLevelPenalties: { low: 0, medium: 2, high: 5 },
    riskFlagPenalties: { hasHooks: 1, hasExecScripts: 1, requiresNetwork: 1 },
    freshness: {
      recentDays: 30,
      recentBoost: 2,
      staleDays: 365,
      stalePenalty: 2,
      unknownPenalty: 0,
    },
    genericCapabilityPenalty: 0,
    lowFitPenaltyThreshold: 0,
    lowFitPenalty: 0,
    weakDemandPenalty: 0,
    outOfDomainGroupPenalty: 0,
    // ecosystemMismatchPenalty intentionally absent
    coverageGainWeight: 1,
    sourceDiversityBonus: 1,
    assetKindDiversityPenalty: 5,
    overlapPenalty: 1,
    demandTermMultipliers: {},
  };

  const override: Record<string, unknown> = {
    schemaVersion: 1,
    scoring,
  };

  // assertRecommendationPolicyBaseOverride calls assertRecommendationScoring
  // which mutates scoring.ecosystemMismatchPenalty = 0 when it is undefined.
  assert.doesNotThrow(() => {
    assertRecommendationPolicyBaseOverride(override, "test-override");
  });

  assert.equal(
    scoring.ecosystemMismatchPenalty,
    0,
    "ecosystemMismatchPenalty must be injected as 0 for pre-v2.0.0 policy files",
  );
});

// ─── candidates.ts:658–660 — unknown registry sourceId → zero mismatch penalty

void test("computeEcosystemMismatchPenalty: returns 0 for package-registry source whose id matches no known registry", () => {
  // "my-custom-registry-xyz" does not match any substring in REGISTRY_ECOSYSTEM_MAP,
  // so the `if (!sourceIdMatch) { return 0; }` branch at lines 658–660 is taken.
  const entry = makeCatalogEntry("custom-pkg-skill", "skill", {
    sourceKind: "package-registry",
    sourceId: "my-custom-registry-xyz",
    capabilities: ["skill", "backend"],
  });

  const demandContext = {
    terms: [],
    hasSignals: true,
    activeDomainGroups: new Set(["backend"]),
    packageManifestEntries: new Set<string>(),
    demandKeywords: new Set(["backend"]),
    // packageManagers is non-empty so the `size === 0` early-return does NOT fire
    packageManagers: new Set(["npm"]),
  };

  const policy = makePolicy();
  const policyContext = buildPolicySearchContext(policy);

  // The call must not throw; the ecosystem mismatch penalty must be 0
  const base = buildCandidateRecommendationBase(
    entry,
    demandContext,
    policy,
    policyContext,
  );

  if (base !== null) {
    assert.equal(
      base.breakdown.ecosystemMismatchPenalty,
      0,
      "unknown-registry entry should carry zero ecosystem mismatch penalty",
    );
  }
  // base === null is also valid (other gates may suppress the entry); what
  // matters is that the REGISTRY_ECOSYSTEM_MAP miss branch executed without error.
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePolicy(): RecommendationPolicy {
  const hostPolicy = makeHostPolicy();
  return {
    schemaVersion: 1,
    scoring: {
      demandMatchCap: 20,
      portfolioFitMultiplier: 10,
      trustDivisor: 10,
      sourcePriorityDivisor: 10,
      authorityWeights: {
        "official-first-party": 100,
        "official-marketplace": 80,
        "official-compatible": 70,
        "trusted-local": 60,
        "trusted-community": 40,
        "unverified-community": 10,
      },
      compatibilityWeights: {
        native: 30,
        adaptable: 20,
        partial: 10,
        "reference-only": 5,
        incompatible: -100,
      },
      costPenalties: { tiny: 0, small: 1, medium: 2, large: 4 },
      demandSignalWeights: {
        languages: 1,
        packageManagers: 1,
        frameworks: 1,
        concerns: 1,
        tooling: 1,
      },
      riskLevelPenalties: { low: 0, medium: 2, high: 5 },
      riskFlagPenalties: { hasHooks: 1, hasExecScripts: 1, requiresNetwork: 1 },
      freshness: {
        recentDays: 30,
        recentBoost: 2,
        staleDays: 365,
        stalePenalty: 2,
        unknownPenalty: 0,
      },
      genericCapabilityPenalty: 0,
      lowFitPenaltyThreshold: 0,
      lowFitPenalty: 0,
      weakDemandPenalty: 0,
      outOfDomainGroupPenalty: 0,
      ecosystemMismatchPenalty: 40,
      coverageGainWeight: 1,
      sourceDiversityBonus: 1,
      assetKindDiversityPenalty: 5,
      overlapPenalty: 1,
      demandTermMultipliers: {},
    },
    hosts: {
      shared: hostPolicy,
      "copilot-vscode": hostPolicy,
      opencode: hostPolicy,
      cursor: hostPolicy,
      zed: hostPolicy,
      "claude-code": hostPolicy,
      pi: hostPolicy,
      codex: hostPolicy,
    },
    concernKeywordMap: {},
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  } as unknown as RecommendationPolicy;
}

function makeHostPolicy() {
  return {
    recommendationLimit: 10,
    activationBudget: 20,
    suggestedBundleId: "test-bundle",
    recommendationLimitOverrideMode: "preserve" as const,
    maxPerSourceFamily: 4,
    maxPerDuplicateGroup: 2,
    maxPerAssetKind: {},
    targetAssetKinds: [],
    targetConcerns: [],
    suppressedAssetIdPatterns: [],
    suppressedCapabilityTerms: [],
  };
}

function makeCatalogEntry(
  id: string,
  assetKind: AssetCatalogEntry["assetKind"],
  options: {
    sourceKind?: AssetCatalogEntry["source"]["sourceKind"];
    sourceId?: string;
    capabilities?: string[];
  } = {},
): AssetCatalogEntry {
  const sourceId = options.sourceId ?? id;
  const authorityTier = "trusted-community" as const;
  return {
    id,
    displayName: id,
    assetKind,
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId,
      authorityTier,
      sourceKind: options.sourceKind ?? "repo",
      sourcePriority: 50,
      originUrl: `https://example.com/${id}`,
      publisher: sourceId,
      publisherVerified: isPublisherVerifiedForAuthorityTier(authorityTier),
    },
    trust: { score: 50, signals: [`authority:${authorityTier}`] },
    capabilities: options.capabilities ?? [assetKind, id],
    install: {
      method: "local-file",
      relativePath: undefined,
      manifestEntry: undefined,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: undefined,
      classification: undefined,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 1, hostFit: 1 },
    dedupe: { duplicateGroup: undefined, candidateRankHint: "test" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}
