import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION_HEADING_PATTERN = /^## \[([^\]]+)\] - .*$/gmu;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function normalizeVersionFromTag(tag) {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function isPreRelease(version) {
  return version.includes("-");
}

export function extractReleaseNotesFromChangelog(changelogText, version) {
  const headingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - .*$`,
    "mu",
  );
  const headingMatch = headingPattern.exec(changelogText);

  if (!headingMatch) {
    throw new Error(`Could not find CHANGELOG entry for version ${version}.`);
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const remainder = changelogText.slice(sectionStart);
  VERSION_HEADING_PATTERN.lastIndex = 0;
  const nextHeadingMatch = VERSION_HEADING_PATTERN.exec(remainder);
  const sectionEnd =
    nextHeadingMatch === null
      ? changelogText.length
      : sectionStart + nextHeadingMatch.index;
  const sectionBody = changelogText.slice(sectionStart, sectionEnd).trim();

  if (sectionBody.length === 0) {
    throw new Error(`CHANGELOG entry for version ${version} is empty.`);
  }

  return sectionBody;
}

export function buildCombinedReleaseNotes({ manualNotes, generatedNotes }) {
  const trimmedManualNotes = manualNotes.trim();
  const trimmedGeneratedNotes = generatedNotes.trim();

  if (!trimmedGeneratedNotes) {
    return trimmedManualNotes;
  }

  if (!trimmedManualNotes) {
    return trimmedGeneratedNotes;
  }

  return `${trimmedManualNotes}\n\n---\n\n## Auto-generated release notes\n\n${trimmedGeneratedNotes}`;
}

export function readManualReleaseNotes(cwd, version) {
  const changelogPath = resolve(cwd, "CHANGELOG.md");
  const changelogText = readFileSync(changelogPath, "utf8");
  return extractReleaseNotesFromChangelog(changelogText, version);
}
