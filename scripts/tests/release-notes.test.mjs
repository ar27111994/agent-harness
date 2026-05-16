import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCombinedReleaseNotes,
  extractReleaseNotesFromChangelog,
  isPreRelease,
  normalizeVersionFromTag,
  readManualReleaseNotes,
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

test("extractReleaseNotesFromChangelog throws when the version section is empty", () => {
  assert.throws(
    () =>
      extractReleaseNotesFromChangelog(
        "# Changelog\n\n## [1.0.7] - 2026-05-15\n\n## [1.0.6] - 2026-05-14\n\n- previous",
        "1.0.7",
      ),
    /CHANGELOG entry for version 1\.0\.7 is empty/u,
  );
});

test("readManualReleaseNotes reads the requested changelog section", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "release-notes-"));
  await writeFile(join(cwd, "CHANGELOG.md"), SAMPLE_CHANGELOG, "utf8");

  assert.equal(
    readManualReleaseNotes(cwd, "1.0.5"),
    "### Changed\n\n- previous release notes",
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

test("buildCombinedReleaseNotes returns only manual notes when generated notes are empty", () => {
  const notes = buildCombinedReleaseNotes({
    manualNotes: "## Changed\n\n- curated summary",
    generatedNotes: "  \n\t  ",
  });

  assert.equal(notes, "## Changed\n\n- curated summary");
});

test("buildCombinedReleaseNotes returns only generated notes when manual notes are empty", () => {
  const notes = buildCombinedReleaseNotes({
    manualNotes: " \n\t ",
    generatedNotes: "## What's Changed\n\n- auto generated context",
  });

  assert.equal(notes, "## What's Changed\n\n- auto generated context");
});

test("buildCombinedReleaseNotes returns an empty string when both note sources are empty", () => {
  const notes = buildCombinedReleaseNotes({
    manualNotes: " \n\t ",
    generatedNotes: "  \n\t  ",
  });

  assert.equal(notes, "");
});

test("normalizeVersionFromTag and isPreRelease follow release-tag semantics", () => {
  assert.equal(normalizeVersionFromTag("v1.0.6"), "1.0.6");
  assert.equal(normalizeVersionFromTag("1.0.6"), "1.0.6");
  assert.equal(isPreRelease("1.0.6"), false);
  assert.equal(isPreRelease("1.0.6-rc.1"), true);
});
