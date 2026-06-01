import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runQuarantine } from "../quarantine.js";
import { readJsonFile } from "../files.js";
import { assertQuarantineStateReport } from "../manifest-validation.js";
import type { QuarantineStateReport } from "../types.js";

void test("quarantine approve records evidence and promotes mirror status", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-quarantine-"),
  );
  try {
    await writeMirrorIndex(projectRoot, [
      buildMirrorEntry("asset-1", "sha256-test"),
    ]);

    const exitCode = await runQuarantine(
      [
        "approve",
        "--asset",
        "asset-1",
        "--reason",
        "reviewed",
        "--reviewer",
        "fixture-reviewer",
      ],
      projectRoot,
    );

    assert.equal(exitCode, 0);
    const [mirrorIndexLine] = (
      await readFile(join(projectRoot, "mirror", "index.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    const mirrorIndexEntry = parseJsonRecord(mirrorIndexLine);
    assert.equal(mirrorIndexEntry.status, "approved-with-warning");

    const reviewLog = await readFile(
      join(projectRoot, "state", "quarantine", "reviews.jsonl"),
      "utf8",
    );
    const reviewEntry = parseJsonRecord(reviewLog.trim());
    assert.equal(reviewEntry.reason, "reviewed");
    assert.equal(reviewEntry.reviewer, "fixture-reviewer");
    assert.deepEqual(reviewEntry.evidence, {
      previousStatus: "quarantined",
      nextStatus: "approved-with-warning",
      upstreamUrl: "https://github.com/example/repo",
      authorityTier: "trusted-community",
      publisher: "example",
      publisherVerified: false,
      contentHash: "hash-sha256-test",
    });

    const report = await readJsonFile<QuarantineStateReport>(
      join(projectRoot, "state", "quarantine", "quarantine-state.json"),
      assertQuarantineStateReport,
    );
    assert.equal(report.summary.approvedWithWarningCount, 1);
    assert.equal(report.summary.quarantinedCount, 0);
    assert.equal(report.entries[0]?.currentState, "approved-with-warning");
    assert.equal(report.entries[0]?.lastReviewedAt, reviewEntry.reviewedAt);
    assert.deepEqual(report.entries[0]?.transitions, [
      "safer-update-available",
      "review-approved",
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("quarantine validator rejects malformed schema versions", () => {
  assert.throws(
    () =>
      assertQuarantineStateReport(
        {
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
          entries: [],
          summary: {
            quarantinedCount: 0,
            approvedWithWarningCount: 0,
            rejectedCount: 0,
            pinnedCount: 0,
            reviewRequiredCount: 0,
          },
        },
        "quarantineReport",
      ),
    /quarantineReport.schemaVersion must be 1/u,
  );
});

void test("quarantine report shows rejected and pinned lifecycle decisions", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-quarantine-"),
  );
  try {
    await writeMirrorIndex(projectRoot, [
      buildMirrorEntry("asset-1", "sha256-rejected", {
        authorityTier: "unverified-community",
      }),
      buildMirrorEntry("asset-2", "sha256-pinned"),
    ]);

    await runQuarantine(
      ["reject", "--asset", "asset-1", "--reason", "prompt injection"],
      projectRoot,
    );
    await runQuarantine(
      ["pin", "--asset", "asset-2", "--reason", "await ownership proof"],
      projectRoot,
    );
    await runQuarantine(["report"], projectRoot);

    const report = await readJsonFile<QuarantineStateReport>(
      join(projectRoot, "state", "quarantine", "quarantine-state.json"),
      assertQuarantineStateReport,
    );
    assert.equal(report.summary.quarantinedCount, 2);
    assert.equal(report.summary.rejectedCount, 1);
    assert.equal(report.summary.pinnedCount, 1);
    assert.equal(report.summary.reviewRequiredCount, 1);

    const rejected = report.entries.find(
      (entry) => entry.assetId === "asset-1",
    );
    const pinned = report.entries.find((entry) => entry.assetId === "asset-2");
    assert.equal(rejected?.reason, "prompt injection");
    assert.equal(rejected?.suggestedAction, "keep-quarantined");
    assert.ok(rejected?.transitions.includes("ownership-changed"));
    assert.ok(rejected?.transitions.includes("review-rejected"));
    assert.equal(pinned?.reason, "await ownership proof");
    assert.equal(pinned?.suggestedAction, "pin");
    assert.ok(pinned?.transitions.includes("review-pinned"));
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("quarantine derives signal- and evidence-based lifecycle transitions", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-quarantine-"),
  );
  try {
    await writeMirrorIndex(projectRoot, [
      // Demotion into quarantine: a prompt-injected community asset.
      buildMirrorEntry("asset-injected", "sha256-injected", {
        authorityTier: "unverified-community",
        status: "quarantined",
        quarantineSignals: {
          promptInjection: true,
          executableRisk: false,
          communityRisk: true,
          highRisk: false,
        },
      }),
      // Community asset shadowed by an official entry of the same asset id.
      buildMirrorEntry("asset-dup", "sha256-dup-community", {
        authorityTier: "trusted-community",
        status: "quarantined",
      }),
      buildMirrorEntry(
        "asset-community-fallback",
        "sha256-community-fallback",
        {
          authorityTier: "unverified-community",
          status: "quarantined",
          quarantineSignals: {
            promptInjection: false,
            executableRisk: false,
            communityRisk: false,
            highRisk: false,
          },
        },
      ),
      buildMirrorEntry("asset-dup", "sha256-dup-official", {
        authorityTier: "official-first-party",
        status: "approved",
      }),
      // Installed/projected asset that flips safe -> risky on refresh.
      buildMirrorEntry("asset-installed", "sha256-installed", {
        status: "quarantined",
        projectionCandidates: [
          { host: "copilot-vscode", projectionType: "adapted-skill" },
        ],
      }),
      // Promotion out of quarantine: previously prompt-injected, now approved.
      buildMirrorEntry("asset-cleared", "sha256-cleared", {
        status: "approved",
      }),
      // Promotion out of quarantine without prior prompt-injection evidence.
      buildMirrorEntry("asset-clean-review", "sha256-clean-review", {
        status: "approved",
      }),
    ]);

    await writeReviewLog(projectRoot, [
      buildReviewDecision("asset-installed", "sha256-installed", {
        action: "rejected",
        previousStatus: "approved",
        nextStatus: "quarantined",
      }),
      buildReviewDecision("asset-cleared", "sha256-cleared", {
        action: "approved",
        previousStatus: "quarantined",
        nextStatus: "approved",
        promptInjection: true,
      }),
      buildReviewDecision("asset-clean-review", "sha256-clean-review", {
        action: "approved",
        previousStatus: "quarantined",
        nextStatus: "approved",
      }),
    ]);

    await runQuarantine(["report"], projectRoot);

    const report = await readJsonFile<QuarantineStateReport>(
      join(projectRoot, "state", "quarantine", "quarantine-state.json"),
      assertQuarantineStateReport,
    );
    const byAsset = (id: string) =>
      report.entries.find((entry) => entry.assetId === id);

    assert.ok(
      byAsset("asset-injected")?.transitions.includes(
        "prompt-injection-detected",
      ),
    );
    const dupCommunity = report.entries.find(
      (entry) => entry.mirrorId === "sha256-dup-community",
    );
    assert.ok(
      dupCommunity?.transitions.includes(
        "official-duplicate-supersedes-community",
      ),
    );
    assert.ok(
      byAsset("asset-community-fallback")?.transitions.includes(
        "ownership-changed",
      ),
    );
    const installed = byAsset("asset-installed");
    assert.ok(installed?.transitions.includes("safe-to-risky"));
    assert.ok(installed?.transitions.includes("installed-asset-became-risky"));
    assert.ok(
      byAsset("asset-cleared")?.transitions.includes(
        "prompt-injection-cleared",
      ),
    );
    assert.equal(
      byAsset("asset-clean-review")?.transitions.includes(
        "prompt-injection-cleared",
      ),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

async function writeMirrorIndex(
  projectRoot: string,
  entries: Array<Record<string, unknown>>,
): Promise<void> {
  await mkdir(join(projectRoot, "mirror"), { recursive: true });
  await writeFile(
    join(projectRoot, "mirror", "index.jsonl"),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
}

function buildMirrorEntry(
  assetId: string,
  mirrorId: string,
  overrides: {
    authorityTier?: string;
    status?: string;
    quarantineSignals?: Record<string, boolean>;
    projectionCandidates?: Array<Record<string, unknown>>;
  } = {},
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    mirrorId,
    assetId,
    upstream: { type: "repo", url: "https://github.com/example/repo" },
    source: {
      authorityTier: overrides.authorityTier ?? "trusted-community",
      publisher: "example",
      publisherVerified: false,
    },
    mirroredAt: new Date(0).toISOString(),
    contentHash: `hash-${mirrorId}`,
    projectionCandidates: overrides.projectionCandidates ?? [],
    status: overrides.status ?? "quarantined",
  };
  if (overrides.quarantineSignals) {
    entry.quarantineSignals = overrides.quarantineSignals;
  }
  return entry;
}

function parseJsonRecord(content: string): Record<string, unknown> {
  const value: unknown = JSON.parse(content);
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

async function writeReviewLog(
  projectRoot: string,
  decisions: Array<Record<string, unknown>>,
): Promise<void> {
  await mkdir(join(projectRoot, "state", "quarantine"), { recursive: true });
  await writeFile(
    join(projectRoot, "state", "quarantine", "reviews.jsonl"),
    decisions.map((decision) => JSON.stringify(decision)).join("\n") + "\n",
    "utf8",
  );
}

function buildReviewDecision(
  assetId: string,
  mirrorId: string,
  overrides: {
    action: string;
    previousStatus: string;
    nextStatus: string;
    promptInjection?: boolean;
  },
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    reviewedAt: new Date(0).toISOString(),
    action: overrides.action,
    assetId,
    mirrorId,
    reason: "fixture",
    evidence: {
      previousStatus: overrides.previousStatus,
      nextStatus: overrides.nextStatus,
      upstreamUrl: "https://github.com/example/repo",
      authorityTier: "trusted-community",
      publisher: "example",
      publisherVerified: false,
      contentHash: `hash-${mirrorId}`,
      promptInjection: overrides.promptInjection,
    },
  };
}
