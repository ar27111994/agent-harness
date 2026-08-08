import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile, writeTextFile } from "../files.js";
import { restoreEnvVar } from "./env-test-utils.js";
import { resolveAssetContent } from "../asset-content.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type { AssetCatalogEntry } from "../types.js";

function buildAsset(
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id: "fixture-skill",
    displayName: "Fixture Skill",
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: "https://example.com/skills/fixture-skill",
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: {
      score: 100,
      signals: ["fixture"],
    },
    capabilities: ["docs", "setup"],
    install: {
      method: "official-index-entry",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: "fixture-skill",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: "SKILL.md",
      rootPath: "https://example.com/skills/fixture-skill",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 10,
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
      estimatedPromptWeight: 2,
    },
    fit: {
      portfolioFit: 0.9,
      hostFit: 0.9,
    },
    dedupe: {
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
    ...overrides,
  };
}

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }

  restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousValue);
}

void test("resolveAssetContent returns null when the activation asset is missing", async () => {
  const activationRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-asset-content-"),
  );

  try {
    const result = await resolveAssetContent({
      activationRoot,
      assetId: "missing-skill",
    });

    assert.equal(result, null);
  } finally {
    await rm(activationRoot, { force: true, recursive: true });
  }
});

void test("resolveAssetContent prefers mirrored content when content.txt exists", async () => {
  const activationRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-asset-content-"),
  );
  const asset = buildAsset();

  try {
    const assetRoot = join(activationRoot, sanitizeAssetId(asset.id));
    await writeJsonFile(join(assetRoot, "asset.json"), asset);
    await writeTextFile(
      join(assetRoot, "content.txt"),
      "# Mirrored\n\nUse mirrored content first.\n",
    );

    const result = await resolveAssetContent({
      activationRoot,
      assetId: asset.id,
    });

    assert.equal(result?.asset.id, asset.id);
    assert.equal(
      result?.content,
      "# Mirrored\n\nUse mirrored content first.\n",
    );
  } finally {
    await rm(activationRoot, { force: true, recursive: true });
  }
});

void test("resolveAssetContent fetches officialskills page content when mirrored content is absent", async () => {
  const activationRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-asset-content-"),
  );
  const asset = buildAsset({
    source: {
      sourceId: "official-index:fixture",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: "https://officialskills.sh/cloudflare/skills/cloudflare",
      publisher: "Cloudflare",
      publisherVerified: true,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: "SKILL.md",
      rootPath: "https://officialskills.sh/cloudflare/skills/cloudflare",
    },
  });
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  try {
    globalThis.fetch = async () =>
      new Response(
        [
          "<html><head>",
          "<title>Cloudflare/cloudflare — Agent Skills | officialskills.sh</title>",
          '<meta name="description" content="Connects official Cloudflare workflows." />',
          "</head><body>",
          "<section><h2>What This Skill Does</h2><p>Automates Cloudflare maintenance.</p><p>Helps teams move faster.</p></section>",
          "<section><h2>When to use it</h2><ul><li>Provision zones</li><li>Inspect deployments</li></ul></section>",
          "npx skills add https://github.com/cloudflare/skills --skill cloudflare",
          "</body></html>",
        ].join(""),
        { status: 200 },
      );

    await writeJsonFile(
      join(activationRoot, sanitizeAssetId(asset.id), "asset.json"),
      asset,
    );

    const result = await resolveAssetContent({
      activationRoot,
      assetId: asset.id,
    });

    assert.equal(result?.asset.id, asset.id);
    assert.match(result?.content ?? "", /^# Cloudflare\/cloudflare$/mu);
    assert.match(result?.content ?? "", /Automates Cloudflare maintenance\./u);
    assert.match(result?.content ?? "", /Provision zones/u);
    assert.match(
      result?.content ?? "",
      /npx skills add https:\/\/github\.com\/cloudflare\/skills --skill cloudflare/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(activationRoot, { force: true, recursive: true });
  }
});

void test("resolveAssetContent ignores valid non-official origins without fetching", async (t) => {
  const activationRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-asset-content-"),
  );
  const asset = buildAsset({
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "docs",
      sourcePriority: 90,
      originUrl: "https://example.com/not-official",
      publisher: "Fixture",
      publisherVerified: false,
    },
  });
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(activationRoot, { force: true, recursive: true });
  });
  globalThis.fetch = async () => {
    throw new Error("non-official origins should not be fetched");
  };

  await writeJsonFile(
    join(activationRoot, sanitizeAssetId(asset.id), "asset.json"),
    asset,
  );

  const result = await resolveAssetContent({
    activationRoot,
    assetId: asset.id,
  });

  assert.equal(result?.asset.id, asset.id);
  assert.match(
    result?.content ?? "",
    /- Origin: https:\/\/example\.com\/not-official/u,
  );
});

void test("resolveAssetContent falls back to asset metadata when no mirrored or official content is available", async () => {
  const activationRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-asset-content-"),
  );
  const asset = buildAsset({
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "docs",
      sourcePriority: 90,
      originUrl: "not a valid url",
      publisher: "Fixture",
      publisherVerified: false,
    },
  });

  try {
    await writeJsonFile(
      join(activationRoot, sanitizeAssetId(asset.id), "asset.json"),
      asset,
    );

    const result = await resolveAssetContent({
      activationRoot,
      assetId: asset.id,
    });

    assert.equal(result?.asset.id, asset.id);
    assert.equal(
      result?.content,
      [
        "# Fixture Skill",
        "",
        "- Asset ID: fixture-skill",
        "- Source: fixture-source",
        "- Authority: trusted-community",
        "- Compatibility: native",
        "- Origin: not a valid url",
        "",
        "## Capabilities",
        "- docs",
        "- setup",
        "",
      ].join("\n"),
    );
  } finally {
    await rm(activationRoot, { force: true, recursive: true });
  }
});
