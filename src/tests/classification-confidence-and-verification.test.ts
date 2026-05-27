import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClassificationConfidence,
  frontmatterEvidence,
  pathEvidence,
  schemaEvidence,
  sourceFamilyEvidence,
} from "../domains/discovery/classification-confidence.js";
import { verifySourceAuthority } from "../domains/discovery/source-verification.js";
import type { SourceDefinition } from "../types.js";

void test("classification confidence falls back to path evidence and combines strong evidence", () => {
  assert.deepEqual(
    buildClassificationConfidence({ assetKind: "skill", evidence: [] }),
    {
      assetKind: "skill",
      confidence: 0.18,
      level: "weak",
      evidence: [pathEvidence()],
    },
  );

  const combined = buildClassificationConfidence({
    assetKind: "workflow",
    evidence: [
      sourceFamilyEvidence("matched workflow source"),
      schemaEvidence("matched workflow manifest"),
      frontmatterEvidence("frontmatter declared workflow"),
    ],
  });

  assert.equal(combined.confidence, 1);
  assert.equal(combined.level, "strong");
});

void test("source authority verification accepts ssh repo owners and publisher docs hosts", () => {
  const sshOfficial = buildOfficialSource("ssh-official", {
    repo: "git@github.com:openai/codex.git",
    publisherOwner: "openai",
  });
  assert.deepEqual(verifySourceAuthority(sshOfficial, { openai: ["OpenAI"] }), {
    sourceId: "ssh-official",
    originalAuthorityTier: "official-first-party",
    effectiveAuthorityTier: "official-first-party",
    verified: true,
    reasons: [],
    evidence: {
      publisherVerified: true,
      publisherOwner: "openai",
      repoOwner: "openai",
      docsHost: "example.com",
      matchedAllowlistOwner: "openai",
    },
  });

  const docsOfficial = buildOfficialSource("docs-official", {
    kind: "docs",
    docsUrl: "https://docs.anthropic.com/skills",
    publisherOwner: "anthropic",
  });
  assert.equal(
    verifySourceAuthority(docsOfficial, {}).effectiveAuthorityTier,
    "official-first-party",
  );

  const invalidDocsOfficial = buildOfficialSource("invalid-docs", {
    kind: "docs",
    docsUrl: "not a url",
    publisherOwner: "anthropic",
  });
  const invalidDocsResult = verifySourceAuthority(invalidDocsOfficial, {});
  assert.equal(invalidDocsResult.effectiveAuthorityTier, "official-compatible");
  assert.ok(
    invalidDocsResult.reasons.includes(
      "official docs host does not match publisher or allowlist evidence",
    ),
  );
});

function buildOfficialSource(
  id: string,
  options: {
    docsUrl?: string;
    kind?: SourceDefinition["kind"];
    publisherOwner: string;
    repo?: string;
  },
): SourceDefinition {
  return {
    id,
    name: id,
    kind: options.kind ?? "repo",
    authorityTier: "official-first-party",
    publisher: {
      name: options.publisherOwner,
      owner: options.publisherOwner,
      verified: true,
    },
    hosts: ["codex"],
    assetKinds: ["skill"],
    discoveryMode: "catalog",
    priority: 100,
    enabled: true,
    endpoints: {
      docsUrl: options.docsUrl ?? "https://example.com/docs",
      repo: options.repo ?? "https://github.com/example/source",
    },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}
