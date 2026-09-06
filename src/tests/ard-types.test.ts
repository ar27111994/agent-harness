import assert from "node:assert/strict";
import test from "node:test";

import {
  ARD_PUBLISHER_FQDN,
  ARD_SCHEMA_URI,
  ARD_SPEC_VERSION,
  ASSET_KIND_TO_ARD_TYPE,
  TRUST_SIGNAL_SCORE_BOOST,
  ardTypeToAssetKind,
  buildArdQueryText,
  getArdPublisherFqdn,
  inferAuthorityTierFromArdUrn,
} from "../ard/types.js";

void test("ARD constants point to the current public 1.0 schema", () => {
  assert.equal(ARD_SPEC_VERSION, "1.0");
  assert.equal(
    ARD_SCHEMA_URI,
    "https://raw.githubusercontent.com/ards-project/ard-spec/main/spec/schemas/ai-catalog.schema.json",
  );
  assert.equal(ARD_PUBLISHER_FQDN, "ar27111994.dev");
});

void test("publisher FQDN supports a trimmed environment override", () => {
  const previous = process.env.AGENT_HARNESS_ARD_PUBLISHER_FQDN;
  process.env.AGENT_HARNESS_ARD_PUBLISHER_FQDN = "  catalog.example.com  ";
  try {
    assert.equal(getArdPublisherFqdn(), "catalog.example.com");
  } finally {
    if (previous === undefined)
      delete process.env.AGENT_HARNESS_ARD_PUBLISHER_FQDN;
    else process.env.AGENT_HARNESS_ARD_PUBLISHER_FQDN = previous;
  }
});

void test("ARD media types round-trip known asset families", () => {
  assert.equal(ASSET_KIND_TO_ARD_TYPE.skill, "application/ai-skill");
  assert.equal(ardTypeToAssetKind("application/mcp-server+json"), "mcp-server");
  assert.equal(ardTypeToAssetKind("application/a2a-agent-card+json"), "agent");
  assert.equal(ardTypeToAssetKind("application/openapi+json"), "payable-api");
  assert.equal(
    ardTypeToAssetKind("application/vscode-extension+json"),
    "extension",
  );
  assert.equal(ardTypeToAssetKind("application/unknown+json"), "skill");
});

void test("ARD publisher authority inference remains conservative", () => {
  assert.equal(
    inferAuthorityTierFromArdUrn("openai.com"),
    "official-first-party",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("example.github.io"),
    "trusted-community",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("unknown.example"),
    "unverified-community",
  );
});

void test("ARD query builder uses workspace demand or a useful fallback", () => {
  assert.match(buildArdQueryText(null), /agent skills MCP tools/u);
  const query = buildArdQueryText({
    schemaVersion: 1,
    generatedAt: "2026-08-19T00:00:00.000Z",
    scanRoot: ".",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["react"],
      concerns: ["testing"],
      tooling: [],
    },
    evidence: [],
  });
  assert.match(query, /typescript/u);
  assert.match(query, /npm/u);
  assert.match(query, /react/u);
  assert.match(query, /testing/u);
});

void test("trust score mapping retains imported ARD and OMS signals", () => {
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["ard-signed"], 5);
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["oms-signed"], 5);
});
