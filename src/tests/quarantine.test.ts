import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runQuarantine } from "../quarantine.js";

test("quarantine approve records review and promotes mirror status", async () => {
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
    assert.equal(JSON.parse(mirrorIndexLine).status, "approved-with-warning");
    const reviewLog = await readFile(
      join(projectRoot, "state", "quarantine", "reviews.jsonl"),
      "utf8",
    );
    assert.equal(JSON.parse(reviewLog.trim()).reason, "reviewed");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
