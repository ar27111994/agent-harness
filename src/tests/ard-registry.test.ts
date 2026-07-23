/**
 * Tests for ARD registry adapter internals (#327).
 *
 * Covers pure helper functions exported via ardRegistryInternals:
 * extractArdTrustSignals, computeArdTrustScore, normalizeScoreToPortfolioFit.
 * The syncArdRegistrySource function requires a real ARD endpoint and is
 * covered indirectly via the c8-ignored dispatch path in source-sync/index.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ardRegistryInternals } from "../domains/discovery/source-sync/registries/ard-registry.js";

const {
  extractArdTrustSignals,
  computeArdTrustScore,
  normalizeScoreToPortfolioFit,
} = ardRegistryInternals;

// ---------------------------------------------------------------------------
// extractArdTrustSignals
// ---------------------------------------------------------------------------

void test("extractArdTrustSignals returns empty array for undefined trustManifest", () => {
  assert.deepEqual(extractArdTrustSignals(undefined), []);
});

void test("extractArdTrustSignals returns empty array for empty object", () => {
  assert.deepEqual(extractArdTrustSignals({}), []);
});

void test("extractArdTrustSignals detects identity binding", () => {
  const signals = extractArdTrustSignals({
    identity: "spiffe://example.com/agent/test",
  });
  assert.ok(signals.includes("ard-identity-bound"));
});

void test("extractArdTrustSignals detects compliance attestations", () => {
  const signals = extractArdTrustSignals({
    attestations: [
      { type: "SOC2-Type2", uri: "https://trust.example.com/soc2.pdf" },
    ],
  });
  assert.ok(signals.includes("ard-compliance-attested"));
  assert.ok(signals.includes("ard-soc2"));
});

void test("extractArdTrustSignals detects HIPAA attestation", () => {
  const signals = extractArdTrustSignals({
    attestations: [{ type: "HIPAA-Audit" }],
  });
  assert.ok(signals.includes("ard-hipaa"));
});

void test("extractArdTrustSignals detects JWS signature", () => {
  const signals = extractArdTrustSignals({
    signature: "eyJhbGciOiJFUzI1NiJ9...",
  });
  assert.ok(signals.includes("ard-signed"));
});

void test("extractArdTrustSignals combines all signal types", () => {
  const signals = extractArdTrustSignals({
    identity: "domain:example.com",
    attestations: [{ type: "SOC2-Type2" }, { type: "HIPAA-Audit" }],
    signature: "jws-string",
  });
  assert.ok(signals.includes("ard-identity-bound"));
  assert.ok(signals.includes("ard-compliance-attested"));
  assert.ok(signals.includes("ard-soc2"));
  assert.ok(signals.includes("ard-hipaa"));
  assert.ok(signals.includes("ard-signed"));
});

void test("extractArdTrustSignals handles non-array attestations gracefully", () => {
  const signals = extractArdTrustSignals({
    attestations: "not-an-array",
  } as unknown as Record<string, unknown>);
  assert.ok(!signals.includes("ard-compliance-attested"));
});

// ---------------------------------------------------------------------------
// computeArdTrustScore
// ---------------------------------------------------------------------------

void test("computeArdTrustScore returns 0 for empty signals", () => {
  assert.equal(computeArdTrustScore([]), 0);
});

void test("computeArdTrustScore sums known signal boosts", () => {
  // ard-identity-bound: 4, ard-signed: 5 = 9
  assert.equal(computeArdTrustScore(["ard-identity-bound", "ard-signed"]), 9);
});

void test("computeArdTrustScore ignores unknown signals", () => {
  assert.equal(computeArdTrustScore(["unknown-signal", "ard-signed"]), 5);
});

void test("computeArdTrustScore returns 0 for all unknown signals", () => {
  assert.equal(computeArdTrustScore(["not-a-signal", "also-unknown"]), 0);
});

// ---------------------------------------------------------------------------
// normalizeScoreToPortfolioFit
// ---------------------------------------------------------------------------

void test("normalizeScoreToPortfolioFit returns 0.5 for undefined score", () => {
  assert.equal(normalizeScoreToPortfolioFit(undefined), 0.5);
});

void test("normalizeScoreToPortfolioFit maps 100 to 1.0", () => {
  assert.equal(normalizeScoreToPortfolioFit(100), 1);
});

void test("normalizeScoreToPortfolioFit maps 50 to 0.5", () => {
  assert.equal(normalizeScoreToPortfolioFit(50), 0.5);
});

void test("normalizeScoreToPortfolioFit maps 0 to 0", () => {
  assert.equal(normalizeScoreToPortfolioFit(0), 0);
});

void test("normalizeScoreToPortfolioFit clamps scores above 100", () => {
  assert.equal(normalizeScoreToPortfolioFit(150), 1);
});

void test("normalizeScoreToPortfolioFit clamps negative scores", () => {
  assert.equal(normalizeScoreToPortfolioFit(-10), 0);
});
