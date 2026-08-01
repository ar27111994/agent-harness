import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceDriftIssues,
  buildBrokenSourceIssues,
  buildSourceCandidateIssues,
  buildSourceVerificationIssues,
  buildReportOnlyPullRequests,
} from "../maintenance-bot-plan.mjs";

// ---------------------------------------------------------------------------
// buildSourceDriftIssues — #412 ciDetected filtering
// ---------------------------------------------------------------------------

test("buildSourceDriftIssues filters out dormant sources when ciDetected is true", () => {
  const report = {
    sources: [
      {
        sourceId: "dormant-ci-repo",
        kind: "repo",
        authorityTier: "trusted-community",
        status: "dormant",
        severity: "warning",
        coverageMode: "sampled",
        syncStatus: "complete",
        harvestedEntries: 0,
        indexedEntries: 0,
        selectedEntries: 0,
        rejectedEntries: 0,
        duplicateRate: 0,
        reasons: ["no entries produced"],
        suggestedAction: "review-source",
        ciDetected: true,
      },
    ],
  };

  const issues = buildSourceDriftIssues(report);
  assert.equal(issues.length, 0);
});

test("buildSourceDriftIssues keeps dormant sources when ciDetected is false", () => {
  const report = {
    sources: [
      {
        sourceId: "dormant-real",
        kind: "repo",
        authorityTier: "trusted-community",
        status: "dormant",
        severity: "warning",
        coverageMode: "sampled",
        syncStatus: "complete",
        harvestedEntries: 0,
        indexedEntries: 0,
        selectedEntries: 0,
        rejectedEntries: 0,
        duplicateRate: 0,
        reasons: ["no entries produced"],
        suggestedAction: "review-source",
        ciDetected: false,
      },
    ],
  };

  const issues = buildSourceDriftIssues(report);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, "Review source drift: dormant-real");
});

test("buildSourceDriftIssues keeps non-dormant sources regardless of ciDetected", () => {
  const report = {
    sources: [
      {
        sourceId: "broken-source",
        kind: "package-registry",
        authorityTier: "unverified-community",
        status: "broken",
        severity: "error",
        coverageMode: "full",
        syncStatus: "failed",
        harvestedEntries: 0,
        indexedEntries: 0,
        selectedEntries: 0,
        rejectedEntries: 0,
        duplicateRate: 0,
        reasons: ["sync failed"],
        suggestedAction: "refresh-sync",
        ciDetected: true,
      },
    ],
  };

  const issues = buildSourceDriftIssues(report);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, "Review source drift: broken-source");
});

test("buildSourceDriftIssues handles null report", () => {
  const issues = buildSourceDriftIssues(null);
  assert.deepEqual(issues, []);
});

test("buildSourceDriftIssues handles report without sources", () => {
  const issues = buildSourceDriftIssues({});
  assert.deepEqual(issues, []);
});

// ---------------------------------------------------------------------------
// buildBrokenSourceIssues — #413 severity=error priority
// ---------------------------------------------------------------------------

test("buildBrokenSourceIssues surfaces severity=error sources", () => {
  const report = {
    sources: [
      {
        sourceId: "broken-1",
        kind: "package-registry",
        authorityTier: "unverified-community",
        status: "broken",
        severity: "error",
        coverageMode: "full",
        syncStatus: "failed",
        harvestedEntries: 0,
        indexedEntries: 0,
        selectedEntries: 0,
        rejectedEntries: 0,
        duplicateRate: 0,
        reasons: ["sync failed"],
        suggestedAction: "refresh-sync",
        ciDetected: false,
      },
      {
        sourceId: "dormant-1",
        kind: "repo",
        authorityTier: "trusted-community",
        status: "dormant",
        severity: "warning",
        coverageMode: "sampled",
        syncStatus: "complete",
        harvestedEntries: 0,
        indexedEntries: 0,
        selectedEntries: 0,
        rejectedEntries: 0,
        duplicateRate: 0,
        reasons: ["no entries"],
        suggestedAction: "review-source",
        ciDetected: false,
      },
    ],
  };

  const issues = buildBrokenSourceIssues(report);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, "Fix broken source: broken-1");
  assert.deepEqual(issues[0].labels, ["maintenance", "broken-source", "error"]);
});

test("buildBrokenSourceIssues returns empty for severity=warning sources", () => {
  const report = {
    sources: [
      {
        sourceId: "warn-1",
        kind: "repo",
        authorityTier: "trusted-community",
        status: "dormant",
        severity: "warning",
        coverageMode: "sampled",
        syncStatus: "complete",
        harvestedEntries: 0,
        indexedEntries: 0,
        selectedEntries: 0,
        rejectedEntries: 0,
        duplicateRate: 0,
        reasons: ["no entries"],
        suggestedAction: "review-source",
        ciDetected: false,
      },
    ],
  };

  const issues = buildBrokenSourceIssues(report);
  assert.equal(issues.length, 0);
});

// ---------------------------------------------------------------------------
// buildSourceCandidateIssues
// ---------------------------------------------------------------------------

test("buildSourceCandidateIssues surfaces review-required candidates", () => {
  const report = {
    candidates: [
      { label: "new-source-1", reviewRequired: true, sourceId: "ns1" },
      { label: "auto-accepted", reviewRequired: false, sourceId: "aa1" },
    ],
  };

  const issues = buildSourceCandidateIssues(report);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, "Review source candidate: new-source-1");
});

// ---------------------------------------------------------------------------
// buildSourceVerificationIssues
// ---------------------------------------------------------------------------

test("buildSourceVerificationIssues surfaces trust demotions", () => {
  const report = {
    entries: [
      {
        sourceId: "demoted-source",
        effectiveAuthorityTier: "unverified-community",
        originalAuthorityTier: "official-first-party",
      },
      {
        sourceId: "stable-source",
        effectiveAuthorityTier: "trusted-community",
        originalAuthorityTier: "trusted-community",
      },
    ],
  };

  const issues = buildSourceVerificationIssues(report);
  assert.equal(issues.length, 1);
  assert.equal(
    issues[0].title,
    "Review official source trust demotion: demoted-source",
  );
});

// ---------------------------------------------------------------------------
// buildReportOnlyPullRequests
// ---------------------------------------------------------------------------

test("buildReportOnlyPullRequests creates PR when no issues and no severe findings", () => {
  const sourceHealth = {
    sourceCount: 5,
    severeCount: 0,
    warningCount: 2,
  };
  const issues = [];

  const prs = buildReportOnlyPullRequests(sourceHealth, issues);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].title, "Refresh maintenance reports");
});

test("buildReportOnlyPullRequests returns empty when issues exist", () => {
  const sourceHealth = { sourceCount: 5, severeCount: 0, warningCount: 2 };
  const issues = [{ title: "some issue" }];

  const prs = buildReportOnlyPullRequests(sourceHealth, issues);
  assert.equal(prs.length, 0);
});

test("buildReportOnlyPullRequests returns empty when severeCount > 0", () => {
  const sourceHealth = { sourceCount: 5, severeCount: 1, warningCount: 2 };
  const issues = [];

  const prs = buildReportOnlyPullRequests(sourceHealth, issues);
  assert.equal(prs.length, 0);
});
