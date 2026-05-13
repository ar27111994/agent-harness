import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCombinedReleaseNotes,
  extractReleaseNotesFromChangelog,
  isPreRelease,
  normalizeVersionFromTag,
} from "../release-notes.mjs";

const SAMPLE_CHANGELOG = `# Changelog

## [Unreleased]

No unreleased changes yet.

## [1.0.6] - 2026-05-13

### Added

- new release automation

### Fixed

- stale playbook wording

## [1.0.5] - 2026-05-12

### Changed

- previous release notes
`;

test("extractReleaseNotesFromChangelog returns the requested version body only", () => {
  const notes = extractReleaseNotesFromChangelog(SAMPLE_CHANGELOG, "1.0.6");

  assert.equal(
    notes,
    "### Added\n\n- new release automation\n\n### Fixed\n\n- stale playbook wording",
  );
});

test("extractReleaseNotesFromChangelog throws when the version is missing", () => {
  assert.throws(
    () => extractReleaseNotesFromChangelog(SAMPLE_CHANGELOG, "9.9.9"),
    /Could not find CHANGELOG entry for version 9\.9\.9/u,
  );
});

test("buildCombinedReleaseNotes blends curated and generated notes", () => {
  const notes = buildCombinedReleaseNotes({
    manualNotes: "## Changed\n\n- curated summary",
    generatedNotes: "## What's Changed\n\n- auto generated context",
  });

  assert.equal(
    notes,
    "## Changed\n\n- curated summary\n\n---\n\n## Auto-generated release notes\n\n## What's Changed\n\n- auto generated context",
  );
});

test("normalizeVersionFromTag and isPreRelease follow release-tag semantics", () => {
  assert.equal(normalizeVersionFromTag("v1.0.6"), "1.0.6");
  assert.equal(normalizeVersionFromTag("1.0.6"), "1.0.6");
  assert.equal(isPreRelease("1.0.6"), false);
  assert.equal(isPreRelease("1.0.6-rc.1"), true);
});
