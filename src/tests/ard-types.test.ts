/**
 * Tests for shared ARD type mappings and helpers (#325, #327, #328).
 *
 * Covers: AssetKind ↔ ARD type mappings, trust signal score boosts,
 * authority tier inference from URN domains, demand-profile query construction.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSET_KIND_TO_ARD_TYPE,
  ardTypeToAssetKind,
  buildArdQueryText,
  inferAuthorityTierFromArdUrn,
  TRUST_SIGNAL_SCORE_BOOST,
  TRUST_SIGNAL_TO_ATTESTATION,
  ARD_PUBLISHER_FQDN,
} from "../ard/types.js";

// ---------------------------------------------------------------------------
// ardTypeToAssetKind
// ---------------------------------------------------------------------------

void test("ardTypeToAssetKind maps known ARD media types", () => {
  assert.equal(ardTypeToAssetKind("application/mcp-server+json"), "mcp-server");
  assert.equal(ardTypeToAssetKind("application/a2a-agent-card+json"), "agent");
  assert.equal(ardTypeToAssetKind("application/ai-skill"), "skill");
  assert.equal(
    ardTypeToAssetKind("application/ai-catalog+json"),
    "reference-pack",
  );
  assert.equal(ardTypeToAssetKind("application/openapi+json"), "payable-api");
  assert.equal(
    ardTypeToAssetKind("application/vscode-extension+json"),
    "extension",
  );
});

void test("ardTypeToAssetKind falls back to skill for unknown types", () => {
  assert.equal(ardTypeToAssetKind("application/unknown+json"), "skill");
  assert.equal(ardTypeToAssetKind(""), "skill");
});

// ---------------------------------------------------------------------------
// inferAuthorityTierFromArdUrn
// ---------------------------------------------------------------------------

void test("inferAuthorityTierFromArdUrn returns official-first-party for known domains", () => {
  assert.equal(
    inferAuthorityTierFromArdUrn("google.com"),
    "official-first-party",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("github.com"),
    "official-first-party",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("microsoft.com"),
    "official-first-party",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("nvidia.com"),
    "official-first-party",
  );
});

void test("inferAuthorityTierFromArdUrn returns trusted-community for hosting platforms", () => {
  assert.equal(
    inferAuthorityTierFromArdUrn("example.github.io"),
    "trusted-community",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("example.gitlab.io"),
    "trusted-community",
  );
});

void test("inferAuthorityTierFromArdUrn stays at unverified-community for unknown domains regardless of trust manifest", () => {
  // Self-declared manifests from unknown publishers do NOT elevate authority.
  assert.equal(
    inferAuthorityTierFromArdUrn("random-skills.com"),
    "unverified-community",
  );
});

void test("inferAuthorityTierFromArdUrn returns unverified-community for unknown domains without trust manifest", () => {
  assert.equal(
    inferAuthorityTierFromArdUrn("ar27111994.dev"),
    "unverified-community",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("random-skills.com"),
    "unverified-community",
  );
});

void test("inferAuthorityTierFromArdUrn returns unverified-community for unknown domains", () => {
  assert.equal(
    inferAuthorityTierFromArdUrn("random-skills.com"),
    "unverified-community",
  );
  assert.equal(
    inferAuthorityTierFromArdUrn("unknown.dev"),
    "unverified-community",
  );
});

void test("inferAuthorityTierFromArdUrn is case-insensitive", () => {
  assert.equal(
    inferAuthorityTierFromArdUrn("GoOgLe.CoM"),
    "official-first-party",
  );
});

// ---------------------------------------------------------------------------
// buildArdQueryText
// ---------------------------------------------------------------------------

void test("buildArdQueryText returns fallback when no demand profile", () => {
  const result = buildArdQueryText(null);
  assert.ok(result.includes("agent skills"));
  assert.ok(result.includes("MCP tools"));
});

void test("buildArdQueryText returns fallback when no demand signals", () => {
  const result = buildArdQueryText({
    schemaVersion: 1,
    generatedAt: "2026-01-01",
    scanRoot: "/tmp",
    summary: { scannedFiles: 0, matchedFiles: 0 },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: [],
      tooling: [],
    },
    evidence: [],
  });
  assert.ok(result.includes("agent skills"));
});

void test("buildArdQueryText includes detected languages", () => {
  const result = buildArdQueryText({
    schemaVersion: 1,
    generatedAt: "2026-01-01",
    scanRoot: "/tmp",
    summary: { scannedFiles: 0, matchedFiles: 0 },
    signals: {
      languages: ["typescript", "python"],
      packageManagers: [],
      frameworks: [],
      concerns: [],
      tooling: [],
    },
    evidence: [],
  });
  assert.ok(result.includes("typescript python"));
});

void test("buildArdQueryText combines all signal types", () => {
  const result = buildArdQueryText({
    schemaVersion: 1,
    generatedAt: "2026-01-01",
    scanRoot: "/tmp",
    summary: { scannedFiles: 0, matchedFiles: 0 },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["nextjs"],
      concerns: ["testing"],
      tooling: [],
    },
    evidence: [],
  });
  assert.ok(result.includes("typescript"));
  assert.ok(result.includes("npm"));
  assert.ok(result.includes("nextjs"));
  assert.ok(result.includes("testing"));
});

// ---------------------------------------------------------------------------
// TRUST_SIGNAL_SCORE_BOOST
// ---------------------------------------------------------------------------

void test("TRUST_SIGNAL_SCORE_BOOST has expected OMS values", () => {
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["oms-signed"], 5);
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["oms-trust-anchor"], 3);
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["publisher-verified"], 2);
});

void test("TRUST_SIGNAL_SCORE_BOOST has expected ARD values", () => {
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["ard-identity-bound"], 4);
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["ard-compliance-attested"], 3);
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["ard-soc2"], 3);
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["ard-hipaa"], 3);
  assert.equal(TRUST_SIGNAL_SCORE_BOOST["ard-signed"], 5);
});

// ---------------------------------------------------------------------------
// ASSET_KIND_TO_ARD_TYPE
// ---------------------------------------------------------------------------

void test("ASSET_KIND_TO_ARD_TYPE covers all core kinds", () => {
  assert.equal(
    ASSET_KIND_TO_ARD_TYPE["mcp-server"],
    "application/mcp-server+json",
  );
  assert.equal(ASSET_KIND_TO_ARD_TYPE["skill"], "application/ai-skill");
  assert.equal(
    ASSET_KIND_TO_ARD_TYPE["agent"],
    "application/a2a-agent-card+json",
  );
  assert.equal(
    ASSET_KIND_TO_ARD_TYPE["reference-pack"],
    "application/ai-catalog+json",
  );
  assert.equal(
    ASSET_KIND_TO_ARD_TYPE["payable-api"],
    "application/openapi+json",
  );
  assert.equal(
    ASSET_KIND_TO_ARD_TYPE["extension"],
    "application/vscode-extension+json",
  );
});

// ---------------------------------------------------------------------------
// TRUST_SIGNAL_TO_ATTESTATION
// ---------------------------------------------------------------------------

void test("TRUST_SIGNAL_TO_ATTESTATION maps ARD signals", () => {
  assert.equal(TRUST_SIGNAL_TO_ATTESTATION["ard-signed"].type, "JWS-Signature");
  assert.equal(
    TRUST_SIGNAL_TO_ATTESTATION["ard-identity-bound"].type,
    "Identity-Binding",
  );
  assert.equal(TRUST_SIGNAL_TO_ATTESTATION["ard-soc2"].type, "SOC2-Type2");
});

void test("TRUST_SIGNAL_TO_ATTESTATION maps OMS signals", () => {
  assert.equal(
    TRUST_SIGNAL_TO_ATTESTATION["oms-signed"].type,
    "OMS-Code-Signature",
  );
  assert.equal(
    TRUST_SIGNAL_TO_ATTESTATION["oms-trust-anchor"].type,
    "OMS-Trust-Anchor",
  );
});

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

void test("ARD_PUBLISHER_FQDN is set correctly", () => {
  assert.equal(ARD_PUBLISHER_FQDN, "ar27111994.dev");
});
