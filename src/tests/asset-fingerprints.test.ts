import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonLinesFile } from "../files.js";
import {
  buildAssetLifecycleFingerprint,
  buildAssetLifecycleFingerprintReport,
  writeAssetLifecycleFingerprintReport,
} from "../domains/discovery/asset-fingerprints.js";
import type { AssetCatalogEntry, MirrorIndexEntry } from "../types.js";

void test("asset lifecycle fingerprints are stable and include mirror trust state", () => {
  const entry = buildCatalogEntry("asset-a", { duplicateGroup: "group-a" });
  const mirror = buildMirrorEntry("asset-a", {
    contentHash: "sha256-content-a",
    status: "quarantined",
  });

  const first = buildAssetLifecycleFingerprint(entry, mirror);
  const second = buildAssetLifecycleFingerprint(entry, mirror);

  assert.equal(first.lifecycleFingerprint, second.lifecycleFingerprint);
  assert.equal(
    first.canonicalUpstreamIdentity,
    "repo|https://example.com/acme/tool|abc123",
  );
  assert.equal(first.sourceCatalogIdentity, "source-a|asset-a|skill|native");
  assert.equal(first.contentHash, "sha256-content-a");
  assert.equal(first.commit, "abc123");

  const versioned = buildAssetLifecycleFingerprint(
    buildCatalogEntry("asset-versioned", { duplicateGroup: undefined }),
    {
      ...mirror,
      upstream: {
        type: "package",
        url: "https://registry.example.com/acme/tool/",
        version: "2.0.0",
        ref: "latest",
      },
    },
  );
  assert.equal(
    versioned.canonicalUpstreamIdentity,
    "package|https://registry.example.com/acme/tool|2.0.0",
  );
  assert.equal(versioned.version, "2.0.0");
  assert.equal(versioned.ref, "latest");

  const pathIdentity = buildAssetLifecycleFingerprint(
    buildCatalogEntry("asset-path-identity", {
      duplicateGroup: undefined,
      install: {
        method: "manual",
        relativePath: "skills/example",
      },
    }),
  );
  assert.equal(
    pathIdentity.canonicalUpstreamIdentity,
    "repo|https://example.com/acme/tool|skills/example",
  );

  const evidencePathIdentity = buildAssetLifecycleFingerprint(
    buildCatalogEntry("asset-evidence-identity", {
      duplicateGroup: undefined,
      install: { method: "manual" },
    }),
  );
  assert.equal(
    evidencePathIdentity.canonicalUpstreamIdentity,
    "repo|https://example.com/acme/tool|asset-evidence-identity/README.md",
  );

  const idOnlyIdentity = buildAssetLifecycleFingerprint(
    buildCatalogEntry("asset-id-identity", {
      duplicateGroup: undefined,
      install: { method: "manual" },
      evidenceFilePath: undefined,
    }),
  );
  assert.equal(
    idOnlyIdentity.canonicalUpstreamIdentity,
    "repo|https://example.com/acme/tool|asset-id-identity",
  );

  const unversioned = buildAssetLifecycleFingerprint(
    buildCatalogEntry("asset-unversioned", { duplicateGroup: undefined }),
    {
      ...mirror,
      upstream: {
        type: "docs",
        url: "https://docs.example.com/tool/",
      },
    },
  );
  assert.equal(
    unversioned.canonicalUpstreamIdentity,
    "docs|https://docs.example.com/tool|unversioned",
  );

  const mixedCasePath = buildAssetLifecycleFingerprint(
    buildCatalogEntry("asset-case-path", { duplicateGroup: undefined }),
    {
      ...mirror,
      upstream: {
        type: "docs",
        url: "HTTPS://EXAMPLE.COM/Acme/Tool/Guide/",
      },
    },
  );
  assert.equal(
    mixedCasePath.canonicalUpstreamIdentity,
    "docs|https://example.com/Acme/Tool/Guide|unversioned",
  );
  assert.equal(first.trustTier, "trusted-community");
  assert.equal(first.quarantineState, "quarantined");
  assert.deepEqual(first.hosts, ["cursor", "opencode"]);
});

void test("asset lifecycle fingerprint report includes duplicate evidence and writes output", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-fingerprints-"),
  );

  try {
    await writeJsonLinesFile(
      join(projectRoot, "discover", "catalog.assets.jsonl"),
      [
        buildCatalogEntry("asset-a", { duplicateGroup: "group-a" }),
        buildCatalogEntry("asset-b", { duplicateGroup: "group-a" }),
        buildCatalogEntry("asset-c"),
      ],
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildMirrorEntry("asset-a", { contentHash: "hash-a" }),
      buildMirrorEntry("asset-b", { contentHash: "hash-b" }),
    ]);

    const report = await buildAssetLifecycleFingerprintReport(projectRoot);
    assert.equal(report.assetCount, 3);
    assert.equal(report.duplicateGroupCount, 1);
    assert.deepEqual(report.duplicateGroups[0]?.assetIds, [
      "asset-a",
      "asset-b",
    ]);
    assert.deepEqual(
      report.duplicateGroups[0]?.evidence.map((entry) => entry.contentHash),
      ["hash-a", "hash-b"],
    );

    await writeAssetLifecycleFingerprintReport(projectRoot);
    const written = JSON.parse(
      await readFile(
        join(projectRoot, "discover", "output", "asset-fingerprints.json"),
        "utf8",
      ),
    ) as typeof report;
    assert.equal(written.assetCount, 3);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function buildCatalogEntry(
  id: string,
  options: {
    duplicateGroup?: string;
    evidenceFilePath?: string;
    install?: AssetCatalogEntry["install"];
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["opencode", "cursor"],
    compatibilityMode: "native",
    source: {
      sourceId: "source-a",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "https://example.com/acme/tool",
      publisher: "acme",
      publisherVerified: false,
    },
    trust: {
      score: 70,
      signals: ["fixture"],
    },
    capabilities: ["testing"],
    install: options.install ?? {
      method: "manual",
      relativePath: `${id}/README.md`,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: false,
      filePath:
        "evidenceFilePath" in options
          ? options.evidenceFilePath
          : `${id}/README.md`,
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
    contentHash?: string;
    status?: MirrorIndexEntry["status"];
  } = {},
): MirrorIndexEntry {
  return {
    mirrorId: `sha256-${assetId}`,
    assetId,
    upstream: {
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
    contentHash: options.contentHash ?? "sha256-content-a",
    projectionCandidates: [
      {
        host: "opencode",
        projectionType: "native-skill",
      },
    ],
    status: options.status ?? "approved",
  };
}
