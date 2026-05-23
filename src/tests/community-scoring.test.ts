import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreCommunityAsset,
  shouldQuarantineCommunityAsset,
} from "../domains/discovery/community-scoring.js";
import { mirrorAcquireInternals } from "../mirror/acquire.js";
import type { AssetCatalogEntry } from "../types.js";

void test("community scoring promotes useful low-risk community assets", () => {
  const score = scoreCommunityAsset(
    buildEntry("safe-skill", {
      authorityTier: "trusted-community",
      assetKind: "skill",
      stars: 250,
      manifestFound: true,
      readmeFound: true,
    }),
  );

  assert.equal(score.decision, "promote");
  assert.ok(score.score >= 70);
  assert.ok(score.reasons.includes("README evidence is present"));
});

void test("community scoring quarantines risky executable integrations", () => {
  const entry = buildEntry("risky-plugin", {
    authorityTier: "trusted-community",
    assetKind: "plugin",
    riskLevel: "medium",
    hasExecScripts: true,
  });

  const score = scoreCommunityAsset(entry);
  assert.equal(score.decision, "quarantine");
  assert.equal(shouldQuarantineCommunityAsset(entry), true);
  assert.ok(
    score.reasons.includes(
      "community executable/integration asset requires review",
    ),
  );
});

void test("mirror status cannot bypass community quarantine policy", () => {
  const entry = buildEntry("community-mcp", {
    authorityTier: "trusted-community",
    assetKind: "mcp-server",
    riskLevel: "low",
  });

  assert.equal(
    mirrorAcquireInternals.determineMirrorStatus(entry, {
      content: Buffer.from("# harmless"),
    }),
    "quarantined",
  );
});

void test("official risky executable assets are approved with warning", () => {
  const entry = buildEntry("official-plugin", {
    authorityTier: "official-first-party",
    assetKind: "plugin",
    riskLevel: "high",
    hasExecScripts: true,
  });

  assert.equal(
    mirrorAcquireInternals.determineMirrorStatus(entry, {
      content: Buffer.from("# reviewed official plugin"),
    }),
    "approved-with-warning",
  );
});

function buildEntry(
  id: string,
  options: {
    authorityTier: AssetCatalogEntry["source"]["authorityTier"];
    assetKind: AssetCatalogEntry["assetKind"];
    stars?: number;
    manifestFound?: boolean;
    readmeFound?: boolean;
    riskLevel?: AssetCatalogEntry["risk"]["level"];
    hasExecScripts?: boolean;
  },
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: options.assetKind,
    hosts: ["opencode"],
    compatibilityMode: "native",
    source: {
      sourceId: "community-source",
      authorityTier: options.authorityTier,
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "https://example.com/community/source",
      publisher: "community",
      publisherVerified: options.authorityTier === "official-first-party",
    },
    trust: { score: 70, signals: ["fixture"] },
    capabilities: ["testing"],
    install: { method: "manual" },
    evidence: {
      manifestFound: options.manifestFound ?? false,
      readmeFound: options.readmeFound ?? false,
      examplesFound: false,
      docsLinked: false,
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: options.stars ?? 1,
      releaseCadence: "active",
    },
    risk: {
      level: options.riskLevel ?? "low",
      hasHooks: false,
      hasExecScripts: options.hasExecScripts ?? false,
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
