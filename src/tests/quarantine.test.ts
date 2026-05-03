import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runQuarantine } from "../quarantine.js";

void test("quarantine approve records review and promotes mirror status", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-quarantine-"),
  );
  try {
    await mkdir(join(projectRoot, "mirror"), { recursive: true });
    await writeFile(
      join(projectRoot, "mirror", "index.jsonl"),
      `${JSON.stringify({
        mirrorId: "sha256-test",
        assetId: "asset-1",
        upstream: { type: "repo", url: "https://github.com/example/repo" },
        source: {
          authorityTier: "trusted-community",
          publisher: "example",
          publisherVerified: false,
        },
        mirroredAt: new Date(0).toISOString(),
        contentHash: "hash",
        projectionCandidates: [],
        status: "quarantined",
      })}\n`,
      "utf8",
    );

    const exitCode = await runQuarantine(
      ["approve", "--asset", "asset-1", "--reason", "reviewed"],
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
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

function parseJsonRecord(content: string): Record<string, unknown> {
  const value: unknown = JSON.parse(content);
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}
