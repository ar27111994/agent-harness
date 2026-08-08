/**
 * Duplicate-id edge-case suite (#428 hardening backlog).
 *
 * Dedicated coverage for the duplicate-identity semantics that decide
 * what survives selection: singleton groups must never become duplicate
 * decisions, group member/evidence ordering must be deterministic,
 * unmirrored group members must surface absent content hashes truthfully,
 * duplicate catalog ids must be preserved rather than silently de-duped,
 * and cross-source duplicates must converge on one canonical upstream
 * identity. The selection pipeline itself is exercised in-process to pin
 * the rejection log ("duplicate" reason) and the sorted decision list.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDiscover } from "../discover.js";
import { buildAssetLifecycleFingerprintReport } from "../domains/discovery/asset-fingerprints.js";
import { writeJsonFile, writeJsonLinesFile } from "../files.js";
import type { AssetCatalogEntry, MirrorIndexEntry } from "../types.js";

void test("singleton duplicate groups are excluded from the duplicate-group report", async () => {
  const projectRoot = await makeFingerprintRoot([
    buildCatalogEntry("asset-solo", { duplicateGroup: "solo-group" }),
    buildCatalogEntry("asset-pair-a", { duplicateGroup: "pair-group" }),
    buildCatalogEntry("asset-pair-b", { duplicateGroup: "pair-group" }),
  ]);
  try {
    const report = await buildAssetLifecycleFingerprintReport(projectRoot);

    assert.equal(report.duplicateGroupCount, 1);
    assert.deepEqual(report.duplicateGroups[0]?.groupId, "pair-group");
    assert.deepEqual(report.duplicateGroups[0]?.assetIds, [
      "asset-pair-a",
      "asset-pair-b",
    ]);
    // The singleton still carries its group tag on the fingerprint itself —
    // exclusion applies to the grouped report, not the identity record.
    const soloFingerprint = report.fingerprints.find(
      (f) => f.assetId === "asset-solo",
    );
    assert.equal(soloFingerprint?.duplicateGroup, "solo-group");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("empty and single-entry catalogs produce no duplicate groups", async () => {
  const emptyRoot = await makeFingerprintRoot([]);
  try {
    const emptyReport = await buildAssetLifecycleFingerprintReport(emptyRoot);
    assert.equal(emptyReport.assetCount, 0);
    assert.equal(emptyReport.duplicateGroupCount, 0);
    assert.deepEqual(emptyReport.duplicateGroups, []);
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
  }

  const singleRoot = await makeFingerprintRoot([
    buildCatalogEntry("asset-only", { duplicateGroup: "lone-group" }),
  ]);
  try {
    const singleReport = await buildAssetLifecycleFingerprintReport(singleRoot);
    assert.equal(singleReport.assetCount, 1);
    assert.equal(
      singleReport.duplicateGroupCount,
      0,
      "one member is not a group",
    );
  } finally {
    await rm(singleRoot, { recursive: true, force: true });
  }
});

void test("duplicate groups sort members, evidence, and fingerprints deterministically", async () => {
  // Insert out of order: group ids and members must still come back sorted.
  const projectRoot = await makeFingerprintRoot([
    buildCatalogEntry("asset-z", { duplicateGroup: "zeta-group" }),
    buildCatalogEntry("asset-z2", { duplicateGroup: "zeta-group" }),
    buildCatalogEntry("asset-a1", { duplicateGroup: "alpha-group" }),
    buildCatalogEntry("asset-a2", { duplicateGroup: "alpha-group" }),
    buildCatalogEntry("asset-a3", { duplicateGroup: "alpha-group" }),
  ]);
  try {
    const report = await buildAssetLifecycleFingerprintReport(projectRoot);

    assert.deepEqual(
      report.duplicateGroups.map((group) => group.groupId),
      ["alpha-group", "zeta-group"],
      "groups must be sorted by group id",
    );

    const alpha = report.duplicateGroups[0];
    assert.ok(alpha);
    assert.deepEqual(alpha.assetIds, ["asset-a1", "asset-a2", "asset-a3"]);
    assert.deepEqual(
      alpha.evidence.map((entry) => entry.assetId),
      ["asset-a1", "asset-a2", "asset-a3"],
      "evidence must be sorted by asset id",
    );
    assert.deepEqual(
      [...alpha.fingerprints].sort(),
      alpha.fingerprints,
      "fingerprint list must be sorted",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("unmirrored duplicate-group members keep content hash absent in evidence", async () => {
  const projectRoot = await makeFingerprintRoot(
    [
      buildCatalogEntry("asset-um-a", { duplicateGroup: "um-group" }),
      buildCatalogEntry("asset-um-b", { duplicateGroup: "um-group" }),
    ],
    [], // no mirror entries
  );
  try {
    const report = await buildAssetLifecycleFingerprintReport(projectRoot);
    const group = report.duplicateGroups[0];
    assert.ok(group);
    assert.equal(report.duplicateGroupCount, 1);
    assert.equal(
      group.evidence[0]?.contentHash,
      undefined,
      "absent mirror state must surface as absent content hash, not a fabricated value",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("duplicate catalog ids are preserved, not de-duplicated, in group member lists", async () => {
  const projectRoot = await makeFingerprintRoot([
    buildCatalogEntry("asset-dup", { duplicateGroup: "same-id-group" }),
    buildCatalogEntry("asset-dup", { duplicateGroup: "same-id-group" }),
  ]);
  try {
    const report = await buildAssetLifecycleFingerprintReport(projectRoot);
    const group = report.duplicateGroups[0];
    assert.ok(group);
    assert.equal(
      group.assetIds.length,
      2,
      "both id occurrences must be listed",
    );
    assert.deepEqual(group.assetIds, ["asset-dup", "asset-dup"]);
    assert.equal(
      report.fingerprints.filter((f) => f.assetId === "asset-dup").length,
      2,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("cross-source duplicates converge on one canonical upstream identity", async () => {
  const sharedUpstream = {
    type: "repo",
    url: "HTTPS://GITHUB.COM/Acme/Tool.Git",
    commit: "abc123",
  } as const;
  const projectRoot = await makeFingerprintRoot(
    [
      buildCatalogEntry("asset-src-a", {
        duplicateGroup: "converged",
        source: {
          sourceId: "source-a",
          originUrl: "https://github.com/acme/tool",
        },
      }),
      buildCatalogEntry("asset-src-b", {
        duplicateGroup: "converged",
        source: {
          sourceId: "source-b",
          originUrl: "https://github.com/acme/tool",
        },
      }),
    ],
    [
      buildMirrorEntry("asset-src-a", { upstream: sharedUpstream }),
      buildMirrorEntry("asset-src-b", { upstream: sharedUpstream }),
    ],
  );
  try {
    const report = await buildAssetLifecycleFingerprintReport(projectRoot);
    const group = report.duplicateGroups[0];
    assert.ok(group);
    assert.deepEqual(group.assetIds, ["asset-src-a", "asset-src-b"]);

    const [fingerprintA, fingerprintB] = report.fingerprints;
    assert.ok(fingerprintA && fingerprintB);
    assert.equal(
      fingerprintA.canonicalUpstreamIdentity,
      "repo|https://github.com/Acme/Tool|abc123",
      "canonical identity must fold hostname casing and strip a terminal .git suffix",
    );
    assert.equal(
      fingerprintA.canonicalUpstreamIdentity,
      fingerprintB.canonicalUpstreamIdentity,
      "distinct sources of the same upstream must converge",
    );
    assert.notEqual(
      fingerprintA.sourceCatalogIdentity,
      fingerprintB.sourceCatalogIdentity,
      "source-scoped identity stays distinct so provenance is never lost",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("discover select records decisions only for real groups and rejects duplicates", async (t) => {
  const { workspaceRoot, stateRoot } = await makeSelectRoot(t);

  await writeJsonLinesFile(
    join(stateRoot, "discover", "catalog.assets.jsonl"),
    [
      buildSelectAsset("entry-dup-1", "dup-group"),
      buildSelectAsset("entry-dup-2", "dup-group"),
      buildSelectAsset("entry-solo", "solo-group"),
    ],
  );

  assert.equal(await runDiscover(["select"], workspaceRoot, stateRoot), 0);

  const selectionReport = JSON.parse(
    await readFile(
      join(stateRoot, "discover", "output", "selection-report.json"),
      "utf8",
    ),
  ) as {
    duplicateDecisions: Array<{
      duplicateGroup: string;
      selectedAssetId: string;
      rejectedAssetIds: string[];
    }>;
  };

  assert.equal(
    selectionReport.duplicateDecisions.length,
    1,
    "only real multi-member groups may produce decisions",
  );
  const decision = selectionReport.duplicateDecisions[0];
  assert.ok(decision);
  assert.equal(decision.duplicateGroup, "dup-group");
  assert.ok(["entry-dup-1", "entry-dup-2"].includes(decision.selectedAssetId));
  assert.deepEqual(decision.rejectedAssetIds, [
    decision.selectedAssetId === "entry-dup-1" ? "entry-dup-2" : "entry-dup-1",
  ]);

  const rejectedLines = (
    await readFile(
      join(stateRoot, "discover", "output", "catalog.rejected.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(
    rejectedLines.length,
    1,
    "exactly the duplicate loser is rejected",
  );
  const rejectedEntry = JSON.parse(rejectedLines[0] ?? "{}") as { id: string };
  assert.ok(
    ["entry-dup-1", "entry-dup-2"].includes(rejectedEntry.id),
    `unexpected rejected id: ${rejectedEntry.id}`,
  );
});

async function makeFingerprintRoot(
  catalogEntries: AssetCatalogEntry[],
  mirrorEntries: MirrorIndexEntry[] = [],
): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-dupids-"));
  await mkdir(join(projectRoot, "discover"), { recursive: true });
  await writeJsonLinesFile(
    join(projectRoot, "discover", "catalog.assets.jsonl"),
    catalogEntries,
  );
  await writeJsonLinesFile(
    join(projectRoot, "mirror", "index.jsonl"),
    mirrorEntries,
  );
  return projectRoot;
}

async function makeSelectRoot(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{ workspaceRoot: string; stateRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-dupselect-"));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  const workspaceRoot = join(projectRoot, "workspace");
  const stateRoot = join(projectRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });

  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });
  await writeJsonFile(join(stateRoot, "discover", "selections.json"), {
    schemaVersion: 1,
    selectionPolicies: {
      officialBeatsPopularity: true,
      starsAreTieBreakerOnly: true,
      preferNativeOverAdaptable: true,
      preferLowerRiskWhenEquivalent: true,
      preferLowerContextCostWhenEquivalent: true,
      communityDefaultPolicy: "catalog-only-unless-promoted",
    },
    rankingOrder: [],
    duplicateGroups: [],
  });
  await writeJsonFile(
    join(stateRoot, "discover", "output", "demand-profile.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoot: workspaceRoot,
      summary: { scannedFiles: 1, matchedFiles: 1 },
      signals: {
        languages: ["typescript"],
        packageManagers: ["npm"],
        frameworks: [],
        concerns: ["testing", "integration"],
        tooling: ["node"],
      },
      evidence: [],
    },
  );
  return { workspaceRoot, stateRoot };
}

function buildSelectAsset(
  id: string,
  duplicateGroup: string,
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: `https://example.com/assets/${id}`,
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["typescript", "testing", "node", "integration", "fixture"],
    install: {
      method: "local-file",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: id,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
      rootPath: "/fixture",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
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
    fit: { portfolioFit: 0.9, hostFit: 0.9 },
    dedupe: { candidateRankHint: "same-family", duplicateGroup },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function buildCatalogEntry(
  id: string,
  options: {
    duplicateGroup?: string;
    source?: Partial<AssetCatalogEntry["source"]>;
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["opencode", "cursor"],
    compatibilityMode: "native",
    source: {
      sourceId: options.source?.sourceId ?? "source-a",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: options.source?.originUrl ?? "https://example.com/acme/tool",
      publisher: "acme",
      publisherVerified: false,
    },
    trust: {
      score: 70,
      signals: ["fixture"],
    },
    capabilities: ["testing"],
    install: {
      method: "manual",
      relativePath: `${id}/README.md`,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: false,
      filePath: `${id}/README.md`,
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 1,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "small",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 0.5,
      hostFit: 0.8,
    },
    dedupe: {
      duplicateGroup: options.duplicateGroup,
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function buildMirrorEntry(
  assetId: string,
  options: {
    upstream?: MirrorIndexEntry["upstream"];
  } = {},
): MirrorIndexEntry {
  return {
    mirrorId: `sha256-${assetId}`,
    assetId,
    upstream: options.upstream ?? {
      type: "repo",
      url: "https://example.com/acme/tool.git",
      commit: "abc123",
    },
    source: {
      authorityTier: "trusted-community",
      publisher: "acme",
      publisherVerified: false,
    },
    mirroredAt: "2026-01-02T00:00:00.000Z",
    contentHash: `hash-${assetId}`,
    projectionCandidates: [],
    status: "approved",
  };
}
