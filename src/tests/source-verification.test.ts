import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { loadSourceRegistry } from "../domains/discovery/source-registry.js";
import {
  applySourceVerificationDemotions,
  buildSourceVerificationReport,
  verifySourceAuthority,
} from "../domains/discovery/source-verification.js";
import type { SourceDefinition } from "../types.js";

void test("official source verification demotes unverified or non-allowlisted official sources", () => {
  const verifiedOfficial = buildSource("verified", {
    repo: "https://github.com/openai/codex",
    publisherOwner: "openai",
    publisherVerified: true,
  });
  const unverifiedOfficial = buildSource("unverified", {
    repo: "https://github.com/openai/codex",
    publisherOwner: "openai",
    publisherVerified: false,
  });
  const mismatchedOwner = buildSource("mismatched", {
    repo: "https://github.com/random/codex",
    publisherOwner: "openai",
    publisherVerified: true,
  });
  const allowlist = { openai: ["openai"] };

  assert.equal(
    verifySourceAuthority(verifiedOfficial, allowlist).effectiveAuthorityTier,
    "official-first-party",
  );
  assert.equal(
    verifySourceAuthority(unverifiedOfficial, allowlist).effectiveAuthorityTier,
    "official-compatible",
  );
  assert.equal(
    verifySourceAuthority(mismatchedOwner, allowlist).effectiveAuthorityTier,
    "official-compatible",
  );
});

void test("source registry applies deterministic official demotions", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-verify-"),
  );

  try {
    await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        buildSource("verified", {
          repo: "https://github.com/openai/codex",
          publisherOwner: "openai",
          publisherVerified: true,
        }),
        buildSource("unverified", {
          repo: "https://github.com/openai/codex-extra",
          publisherOwner: "openai",
          publisherVerified: false,
        }),
      ],
    });
    await writeJsonFile(join(projectRoot, "discover", "selections.json"), {
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
      join(projectRoot, "discover", "official-upstreams.json"),
      {
        schemaVersion: 1,
        owners: { openai: ["openai"] },
      },
    );

    const registry = await loadSourceRegistry(projectRoot);
    assert.equal(
      registry.sources.find((source) => source.id === "verified")
        ?.authorityTier,
      "official-first-party",
    );
    assert.equal(
      registry.sources.find((source) => source.id === "unverified")
        ?.authorityTier,
      "official-compatible",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source verification reports and applies demotion counts", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-report-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "discover", "official-upstreams.json"),
      {
        schemaVersion: 1,
        owners: { openai: ["openai"] },
      },
    );
    const sources = [
      buildSource("verified", {
        repo: "https://github.com/openai/codex",
        publisherOwner: "openai",
        publisherVerified: true,
      }),
      buildSource("mismatch", {
        repo: "https://github.com/community/codex",
        publisherOwner: "openai",
        publisherVerified: true,
      }),
    ];
    const report = await buildSourceVerificationReport(projectRoot, sources);
    const demoted = applySourceVerificationDemotions(sources, report);

    assert.equal(report.demotedSourceCount, 1);
    assert.equal(demoted[1]?.authorityTier, "official-compatible");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function buildSource(
  id: string,
  options: {
    repo: string;
    publisherOwner: string;
    publisherVerified: boolean;
  },
): SourceDefinition {
  return {
    id,
    name: id,
    kind: "repo",
    authorityTier: "official-first-party",
    publisher: {
      name: options.publisherOwner,
      owner: options.publisherOwner,
      verified: options.publisherVerified,
    },
    hosts: ["codex"],
    assetKinds: ["skill"],
    discoveryMode: "catalog",
    priority: 100,
    enabled: true,
    endpoints: {
      repo: options.repo,
    },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}
