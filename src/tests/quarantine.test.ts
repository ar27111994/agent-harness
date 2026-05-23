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
    assert.equal(rejected?.suggestedAction, "review");
    assert.ok(rejected?.transitions.includes("ownership-changed"));
    assert.ok(rejected?.transitions.includes("review-rejected"));
    assert.equal(pinned?.reason, "await ownership proof");
    assert.equal(pinned?.suggestedAction, "pin");
    assert.ok(pinned?.transitions.includes("review-pinned"));
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
  overrides: { authorityTier?: string } = {},
): Record<string, unknown> {
  return {
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
    projectionCandidates: [],
    status: "quarantined",
  };
}

function parseJsonRecord(content: string): Record<string, unknown> {
  const value: unknown = JSON.parse(content);
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}
