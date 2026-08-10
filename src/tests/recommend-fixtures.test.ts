import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecommendationFixtures,
  createDemandProfile,
} from "../recommend-fixtures.js";

void test("recommendation fixture demand profiles default omitted concern and tooling signals", () => {
  const demandProfile = createDemandProfile({
    frameworks: ["react"],
  });

  assert.deepEqual(demandProfile.signals.concerns, []);
  assert.deepEqual(demandProfile.signals.tooling, []);
  assert.deepEqual(demandProfile.evidence[0]?.matchedSignals.concerns, []);
  assert.deepEqual(demandProfile.evidence[0]?.matchedSignals.tooling, []);
  assert.deepEqual(demandProfile.evidence[1]?.matchedSignals.concerns, []);
  assert.deepEqual(demandProfile.evidence[1]?.matchedSignals.tooling, []);
});

void test("recommendation fixtures cover every release evaluation scenario", () => {
  const fixtures = buildRecommendationFixtures();
  const fixtureIds = fixtures.map((fixture) => fixture.id);

  assert.deepEqual(fixtureIds, [
    "backend-integration",
    "frontend-quality",
    "infra-security",
    "python-api-precision",
    "laravel-web-stack",
    "noisy-docs-narrow-runtime",
    "local-availability-separation",
    "shared-executable-bias",
    "shared-source-saturation",
    "false-positive-suppression",
    "dependency-self-echo",
    "ecosystem-exact-stack-gates",
    "design-tool-recall",
    "native-host-policy-coverage",
  ]);

  for (const fixture of fixtures) {
    assert.equal(fixture.schemaVersion, 1);
    assert.ok(fixture.description.length > 0, fixture.id);
    assert.ok(fixture.catalogEntries.length > 0, fixture.id);
    assert.ok(fixture.expectations.length > 0, fixture.id);
    assert.ok(fixture.demandProfile.signals, fixture.id);

    const assetIds = new Set(fixture.catalogEntries.map((entry) => entry.id));
    assert.equal(assetIds.size, fixture.catalogEntries.length, fixture.id);

    for (const entry of fixture.catalogEntries) {
      assert.ok(entry.displayName.length > 0, entry.id);
      assert.ok(entry.source.sourceId.length > 0, entry.id);
      assert.ok(entry.capabilities.length > 0, entry.id);
      assert.ok(entry.hosts.length > 0, entry.id);
      assert.equal(typeof entry.source.publisherVerified, "boolean", entry.id);
    }
  }
});
