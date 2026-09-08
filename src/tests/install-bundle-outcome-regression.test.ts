import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createContentHash,
  writeJsonFile,
  writeJsonLinesFile,
  writeTextFile,
} from "../files.js";
import {
  formatInstallBundleOutcomeSummary,
  installBundleOutcomeHasProblems,
  summarizeInstallBundleOutcome,
} from "../install/bundle-outcome.js";
import { INSTALL_PROGRESS_STATE_OUTPUT_PATH } from "../install/paths.js";
import { runInstall } from "../install.js";
import { sanitizeMirrorId } from "../mirror/paths.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  InstallProgressState,
  MirrorIndexEntry,
} from "../types.js";

void test("tampered mirror artifacts produce a skipped summary and non-zero install exit", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-outcome-"),
  );
  const asset = buildAsset("integrity-fixture");
  const mirrorId = "sha256-integrity-fixture";
  const output: string[] = [];

  t.mock.method(console, "log", (...values: unknown[]) => {
    output.push(values.map(String).join(" "));
  });
  t.mock.method(console, "warn", (...values: unknown[]) => {
    output.push(values.map(String).join(" "));
  });

  try {
    const aggregateHash = await writeMirrorArtifact(
      projectRoot,
      mirrorId,
      asset,
    );
    await writeTextFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        sanitizeMirrorId(mirrorId),
        "content.txt",
      ),
      "tampered after manifest creation\n",
    );

    const mirrorEntry: MirrorIndexEntry = {
      mirrorId,
      assetId: asset.id,
      upstream: { type: "docs", url: asset.source.originUrl },
      source: {
        authorityTier: asset.source.authorityTier,
        publisher: asset.source.publisher,
        publisherVerified: asset.source.publisherVerified,
      },
      mirroredAt: new Date().toISOString(),
      contentHash: aggregateHash,
      projectionCandidates: [
        { host: "copilot-vscode", projectionType: "native-skill" },
      ],
      status: "approved",
    };
    const bundleLock: BundleLock = {
      schemaVersion: 1,
      bundleId: "copilot-core",
      generatedAt: new Date().toISOString(),
      host: "copilot-vscode",
      assets: [
        {
          assetId: asset.id,
          mirrorId,
          projectionType: "native-skill",
          activationEligible: true,
        },
      ],
    };

    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      mirrorEntry,
    ]);
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [asset],
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      bundleLock,
    );

    const exitCode = await runInstall(
      ["bundle", "--bundle", "copilot-core"],
      projectRoot,
      projectRoot,
    );

    assert.equal(exitCode, 1);
    assert.match(output.join("\n"), /Mirror artifact hash mismatch/u);
    assert.match(
      output.join("\n"),
      /Install bundle summary \(latest batch\): staged=0 skipped=1 failed=0/u,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("bundle outcome summaries honor bundle and asset scopes", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-summary-"),
  );

  try {
    const state: InstallProgressState = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      bundles: {
        "copilot-core": {
          host: "copilot-vscode",
          batchSize: 3,
          totalAssets: 4,
          installedAssets: 2,
          remainingAssets: 0,
          lastBatchAssetIds: ["asset-a", "asset-a", "asset-b"],
          skippedAssetIds: ["asset-c", "asset-c"],
        },
        "not-a-default-bundle": {
          host: "shared",
          batchSize: 1,
          totalAssets: 1,
          installedAssets: 0,
          remainingAssets: 0,
          lastBatchAssetIds: [],
          skippedAssetIds: ["asset-z"],
        },
      },
    };
    await writeJsonFile(
      join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
      state,
    );

    const defaultSummary = await summarizeInstallBundleOutcome(projectRoot, []);
    assert.equal(defaultSummary.staged >= 2, true);
    assert.equal(defaultSummary.skipped >= 1, true);

    const filtered = await summarizeInstallBundleOutcome(projectRoot, [
      "--bundle",
      "copilot-core",
      "--asset",
      "asset-c",
    ]);
    assert.deepEqual(filtered, { staged: 0, skipped: 1, failed: 0 });
    assert.equal(installBundleOutcomeHasProblems(filtered), true);
    assert.equal(
      formatInstallBundleOutcomeSummary(filtered),
      "Install bundle summary (latest batch): staged=0 skipped=1 failed=0",
    );

    assert.equal(
      installBundleOutcomeHasProblems({ staged: 1, skipped: 0, failed: 0 }),
      false,
    );
    assert.equal(
      installBundleOutcomeHasProblems({ staged: 0, skipped: 0, failed: 1 }),
      true,
    );

    const unknownBundle = await summarizeInstallBundleOutcome(projectRoot, [
      "--bundle",
      "missing-bundle",
    ]);
    assert.deepEqual(unknownBundle, { staged: 0, skipped: 0, failed: 0 });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("bundle outcome summary is empty before progress exists", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-summary-empty-"),
  );
  try {
    assert.deepEqual(await summarizeInstallBundleOutcome(projectRoot, []), {
      staged: 0,
      skipped: 0,
      failed: 0,
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function buildAsset(id: string): AssetCatalogEntry {
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
      originUrl: `https://example.com/${id}`,
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["fixture"],
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
    fit: { portfolioFit: 0.8, hostFit: 0.9 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

async function writeMirrorArtifact(
  projectRoot: string,
  mirrorId: string,
  entry: AssetCatalogEntry,
): Promise<string> {
  const rawRoot = join(
    projectRoot,
    "mirror",
    "raw",
    sanitizeMirrorId(mirrorId),
  );
  const files = [
    { relativePath: "content.txt", content: `fixture:${entry.id}\n` },
    {
      relativePath: "asset.json",
      content: `${JSON.stringify(entry, null, 2)}\n`,
    },
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const manifestFiles = files.map((file) => ({
    relativePath: file.relativePath,
    sha256: createContentHash(file.content),
    sizeBytes: Buffer.byteLength(file.content),
  }));
  const aggregateHash = createContentHash(
    manifestFiles
      .map((file) =>
        [file.relativePath, file.sha256, String(file.sizeBytes), ""].join("\0"),
      )
      .join("\n"),
  );

  for (const file of files) {
    await writeTextFile(join(rawRoot, file.relativePath), file.content);
  }
  await writeJsonFile(join(rawRoot, "manifest.json"), {
    schemaVersion: 1,
    aggregateHash,
    files: manifestFiles,
  });
  return aggregateHash;
}
