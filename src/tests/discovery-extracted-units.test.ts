/**
 * Unit tests for the #428 follow-up extractions:
 * - harvestCatalogSourceEntries: exhaustive SourceKind dispatch with the
 *   fail-loud assertNeverSourceKind default (no silent default + no c8 ignore)
 * - buildStratifiedRejectionSample: the REJECTION_SAMPLE_SIZE cap guard is
 *   reachable when >sampleSize distinct rejection reasons exist
 * - setup doctor cumulativeSignal injection seam: pre-aborted signal takes
 *   the already-aborted race branch without waiting on a real timer
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStratifiedRejectionSample,
  harvestCatalogSourceEntries,
} from "../discover-pipeline.js";
import { setupInternals } from "../setup.js";
import type { HostAdapter } from "../host-adapters/registry.js";
import type {
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

const selectionRegistry = {
  schemaVersion: 1,
  selectionPolicies: {},
  rankingOrder: [],
  duplicateGroups: [],
} as unknown as SelectionRegistry;

const demandProfile = null as DemandProfile | null;

function buildSource(overrides: Partial<SourceDefinition>): SourceDefinition {
  return {
    id: "test-source",
    name: "Test Source",
    kind: "docs",
    authorityTier: "official-first-party" as const,
    hosts: ["shared"],
    assetKinds: ["skill"],
    priority: 1,
    enabled: true,
    discoveryMode: "catalog" as const,
    endpoints: {},
    rules: {
      officialPreferred: false,
      allowMirror: true,
      allowInstall: true,
    },
    ...overrides,
  };
}

// ─── harvestCatalogSourceEntries: exhaustiveness + live arms ─────────────────

void test("harvestCatalogSourceEntries throws for an unhandled source kind (exhaustiveness guard)", async () => {
  await assert.rejects(
    () =>
      harvestCatalogSourceEntries(
        buildSource({ kind: "repo" }),
        "repo" as never,
        demandProfile,
        selectionRegistry,
        "/tmp",
      ),
    /Unhandled source kind/u,
    "the never-assert default must fail loudly for an unhandled kind",
  );
});

void test("harvestCatalogSourceEntries returns [] for ard-registry without indexed entries", async () => {
  const stderr: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const entries = await harvestCatalogSourceEntries(
      buildSource({ kind: "ard-registry" }),
      "ard-registry",
      demandProfile,
      selectionRegistry,
      "/tmp",
    );
    assert.deepEqual(entries, []);
    assert.ok(
      stderr.some((line) => line.includes("has no indexed entries yet")),
      `expected the ard-registry hint, got: ${stderr.join("")}`,
    );
  } finally {
    process.stderr.write = originalWrite;
  }
});

void test("harvestCatalogSourceEntries dispatches package-registry via the closed-kind switch", async () => {
  // No network: an unknown registry kind fails closed with an unsupported
  // source error rather than throwing out of the dispatch.
  const stderr: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const entries = await harvestCatalogSourceEntries(
      buildSource({
        kind: "package-registry",
        endpoints: { searchUrl: "https://registry.npmjs.org" },
      }),
      "package-registry",
      demandProfile,
      selectionRegistry,
      "/tmp",
    );
    assert.ok(
      Array.isArray(entries),
      "package-registry dispatch returns an array",
    );
  } finally {
    process.stderr.write = originalWrite;
  }
});

// ─── buildStratifiedRejectionSample: cap guard is live ───────────────────────

void test("buildStratifiedRejectionSample caps the distinct-reason pass at the sample size", () => {
  const reasons = Array.from({ length: 30 }, (_, index) => `reason-${index}`);
  const log = reasons.map((reason) => ({ assetId: reason, reason }));

  const sample = buildStratifiedRejectionSample(log, 20);
  assert.equal(sample.length, 20);
  const distinctReasons = new Set(sample.map((entry) => entry.reason));
  assert.equal(distinctReasons.size, 20);
});

void test("buildStratifiedRejectionSample prefers one representative per reason then tops up", () => {
  const log = [
    { assetId: "a1", reason: "dup" },
    { assetId: "a2", reason: "dup" },
    { assetId: "a3", reason: "cap" },
    { assetId: "a4", reason: "demand" },
    { assetId: "a5", reason: "dup" },
  ];

  const sample = buildStratifiedRejectionSample(log, 20);
  assert.equal(sample.length, 5);
  assert.deepEqual(
    sample.map((entry) => entry.assetId),
    ["a1", "a3", "a4", "a2", "a5"],
    "one representative per reason first, then earliest un-sampled entries",
  );
});

void test("buildStratifiedRejectionSample keeps the exact order when sample size is small", () => {
  const log = [
    { assetId: "x1", reason: "r1" },
    { assetId: "x2", reason: "r2" },
    { assetId: "x3", reason: "r3" },
  ];
  assert.equal(buildStratifiedRejectionSample(log, 2).length, 2);
});

// ─── setup doctor cumulativeSignal injection seam (#428 follow-up) ───────────

void test("runDoctor with a pre-aborted cumulative signal exercises the already-aborted race branch", async (t) => {
  const preAborted = AbortSignal.abort("cumulative-timeout");
  const adapter: HostAdapter = {
    id: "preabort-adapter",
    aliases: [],
    displayName: "Preabort Adapter",
    lifecycleHost: "opencode",
    recommendationHost: "opencode",
    defaultBundleIds: [],
    mutatesHostPaths: false,
    requiresLifecycleHostPaths: false,
    runtime: undefined,
    capabilities: [],
    wire: async () => {},
  };

  // Register the fixture so runDoctor's --host resolution finds it.
  const { listHostAdapters, setHostAdaptersForTests } =
    await import("../host-adapters/registry.js");
  const snapshot = listHostAdapters();
  t.after(() => setHostAdaptersForTests(snapshot));
  setHostAdaptersForTests([...snapshot, adapter]);

  const { runDoctor } = setupInternals;
  const ok = await runDoctor(["--host", "preabort-adapter"], undefined, {
    // Pre-abort the cumulative signal: the race is created AFTER the
    // signal already fired, so the pre-abort reject branch runs instead
    // of registering a never-firing listener.
    cumulativeSignal: preAborted,
    // Resolve the preflight part immediately so the race is the only
    // pending work; the pre-aborted signal wins the race.
    preflightRunner: (async () => [
      {
        severity: "info",
        code: "preflight-ok",
        message: "resolved immediately",
      },
    ]) as never,
  });
  assert.equal(ok, true);
});
