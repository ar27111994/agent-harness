import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreCommunityAsset,
  shouldQuarantineCommunityAsset,
} from "../domains/discovery/community-scoring.js";
import { mirrorAcquireInternals } from "../mirror/acquire.js";
import type { AssetCatalogEntry } from "../types.js";

void test("community scoring leaves official assets promoted", () => {
  assert.equal(
    scoreCommunityAsset(
      buildEntry("official", {
        authorityTier: "official-compatible",
        assetKind: "skill",
      }),
    ).decision,
    "promote",
  );
});

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

void test("community scoring reviews unverified community assets", () => {
  const score = scoreCommunityAsset(
    buildEntry("unverified-skill", {
      authorityTier: "unverified-community",
      assetKind: "skill",
      manifestFound: true,
      readmeFound: true,
    }),
  );

  assert.equal(score.decision, "review");
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

void test("community scoring reviews stale duplicate community assets and clamps weak scores", () => {
  const score = scoreCommunityAsset(
    buildEntry("stale-duplicate", {
      authorityTier: "trusted-community",
      assetKind: "skill",
      duplicateGroup: "testing-skills",
      manifestFound: true,
      readmeFound: true,
      releaseCadence: "stale",
      stars: 250,
    }),
  );

  assert.equal(score.decision, "review");
  assert.ok(score.reasons.includes("release cadence is stale"));
  assert.ok(
    score.reasons.includes("asset duplicates an existing capability group"),
  );

  const weakScore = scoreCommunityAsset(
    buildEntry("weak-community", {
      authorityTier: "trusted-community",
      assetKind: "plugin",
      duplicateGroup: "weak-group",
      hasExecScripts: true,
      manifestFound: false,
      readmeFound: false,
      releaseCadence: "unknown",
    }),
  );
  assert.equal(weakScore.score, 0);
  assert.equal(weakScore.decision, "quarantine");
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
    assetKind: "skill",
    riskLevel: "high",
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
    duplicateGroup?: string;
    hasExecScripts?: boolean;
    releaseCadence?: string;
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
      releaseCadence: options.releaseCadence ?? "active",
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
