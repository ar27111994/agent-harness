import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import {
  createIsolatedCliEnvironment,
  runBuiltCli,
} from "./built-cli-harness.js";

/**
 * Cross-process contention tests: multiple real CLI processes (separate OS
 * processes, shared filesystem) writing the same lifecycle state
 * concurrently — the real multi-agent scenario the in-process concurrency
 * suite cannot produce. The atomic write contract (#427) guarantees readers
 * never observe torn files and writers never leave temp litter, even when
 * several processes race on the same mirror index.
 */

/** Number of mirror-index entries seeded for contention fixtures. */
const CONTENTION_INDEX_SIZE = 40;

/** Concurrent CLI writers launched against the same state root. */
const CONCURRENT_WRITERS = 8;

/** Builds a quarantined mirror entry in the shape the CLI validates. */
function buildMirrorEntry(assetId: string, index: number): string {
  return JSON.stringify({
    mirrorId: `mirror-${index}`,
    assetId,
    upstream: { type: "repo", url: `https://github.com/example/${assetId}` },
    source: {
      authorityTier: "trusted-community",
      publisher: "example",
      publisherVerified: false,
    },
    mirroredAt: new Date(0).toISOString(),
    contentHash: `hash-mirror-${index}`,
    projectionCandidates: [],
    status: "quarantined",
  });
}

/** Seeds the mirror index with CONTENTION_INDEX_SIZE quarantined entries. */
async function seedMirrorIndex(projectRoot: string): Promise<void> {
  const entries = Array.from({ length: CONTENTION_INDEX_SIZE }, (_, index) =>
    buildMirrorEntry(`asset-${index}`, index),
  );
  await mkdir(join(projectRoot, "mirror"), { recursive: true });
  await writeFile(
    join(projectRoot, "mirror", "index.jsonl"),
    entries.join("\n") + "\n",
    "utf8",
  );
}

/**
 * Recursively collects every path under root that matches the atomic-writer
 * temp-file naming pattern (`<name>.tmp-<ts>-<rand>`).
 */
async function collectTempLitter(root: string): Promise<string[]> {
  const litter: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (/\.tmp-/u.test(entry.name)) {
        litter.push(relative(root, entryPath));
      }
    }
  }
  await walk(root);
  return litter;
}

/**
 * Removes a temp tree with a bounded retry: on Windows, spawned child
 * processes can retain working-directory handles briefly after exit, so a
 * single immediate rmdir can fail with EBUSY even though the process is
 * gone.
 */
async function removeWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { force: true, recursive: true });
      return;
    } catch (error) {
      const lastAttempt = attempt === 4;
      if (lastAttempt || !isBusyError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** Returns whether a filesystem error is a transient busy/lock condition. */
function isBusyError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

/** Asserts every non-empty line of a JSONL file parses as an object. */
async function assertValidJsonLines(filePath: string): Promise<unknown[]> {
  const content = await readFile(filePath, "utf8");
  const records: unknown[] = [];
  for (const line of content.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    const record: unknown = JSON.parse(line);
    assert.equal(typeof record, "object");
    assert.notEqual(record, null);
    records.push(record);
  }
  return records;
}

void test("concurrent quarantine review writers leave valid, uncorrupted state (atomic write contract)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-cross-proc-"));
  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, {
        createStateRoot: false,
      });
    await seedMirrorIndex(stateRoot);

    // Approve a different asset from each concurrent process. Reads and
    // writes race on the same mirror/index.jsonl; the atomic-write
    // contract (#427) permits last-writer-wins but never torn state.
    const writers = Array.from({ length: CONCURRENT_WRITERS }, (_, index) =>
      runBuiltCli({
        cwd: workspaceRoot,
        env,
        stateRoot,
        timeout: 60_000,
        args: [
          "quarantine",
          "approve",
          "--asset",
          `asset-${index}`,
          "--reason",
          "cross-process contention fixture",
          "--reviewer",
          `process-${index}`,
        ],
      }),
    );
    const results = await Promise.all(writers);

    for (const result of results) {
      assert.equal(result.stderr, "", `unexpected stderr: ${result.stderr}`);
    }

    const indexRecords = (await assertValidJsonLines(
      join(stateRoot, "mirror", "index.jsonl"),
    )) as Array<Record<string, unknown>>;
    assert.equal(
      indexRecords.length,
      CONTENTION_INDEX_SIZE,
      "index must keep exactly the seeded entry count — no line lost to a torn write",
    );
    for (const record of indexRecords) {
      assert.ok(
        ["quarantined", "approved-with-warning"].includes(
          String(record.status),
        ),
        `unexpected status: ${String(record.status)}`,
      );
    }
    assert.ok(
      indexRecords.some((record) => record.status === "approved-with-warning"),
      "at least one concurrent approval must have landed",
    );

    const reviewRecords = (await assertValidJsonLines(
      join(stateRoot, "state", "quarantine", "reviews.jsonl"),
    )) as Array<Record<string, unknown>>;
    for (const record of reviewRecords) {
      assert.equal(record.schemaVersion, 1);
      assert.equal(record.action, "approved");
    }
    assert.ok(reviewRecords.length > 0);

    // The quarantine state report must be valid JSON and parse to a valid
    // report shape.
    const reportContent = await readFile(
      join(stateRoot, "state", "quarantine", "quarantine-state.json"),
      "utf8",
    );
    const report: Record<string, unknown> = JSON.parse(reportContent) as Record<
      string,
      unknown
    >;
    assert.equal(report.schemaVersion, 1);
    assert.ok(Array.isArray(report.entries));

    assert.deepEqual(
      await collectTempLitter(stateRoot),
      [],
      "atomic writes must not leave .tmp-* litter behind after contention",
    );
  } finally {
    await removeWithRetry(tempRoot);
  }
});

void test("readers observe complete state while concurrent writers churn the mirror index", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-cross-proc-read-"),
  );
  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, {
        createStateRoot: false,
      });
    await seedMirrorIndex(stateRoot);

    // Launch a reader against the same state root while six writers churn.
    // The reader must never see a torn line: every output row parses.
    const reader = runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 60_000,
      args: ["quarantine", "list"],
    });
    const writers = Array.from({ length: 6 }, (_, index) =>
      runBuiltCli({
        cwd: workspaceRoot,
        env,
        stateRoot,
        timeout: 60_000,
        args: [
          "quarantine",
          "approve",
          "--asset",
          `asset-${10 + index}`,
          "--reason",
          "reader-churn fixture",
        ],
      }),
    );
    const [readerResult, ...writerResults] = await Promise.all([
      reader,
      ...writers,
    ]);

    assert.equal(readerResult.stderr, "");
    for (const line of readerResult.stdout.split(/\r?\n/u)) {
      if (line.trim().length === 0) {
        continue;
      }
      // list output is tab-separated: assetId \t mirrorId \t tier \t url.
      const fields = line.split("\t");
      assert.equal(fields.length, 4, `torn list row: ${line}`);
      assert.ok(String(fields[0]).startsWith("asset-"));
    }
    for (const result of writerResults) {
      assert.equal(result.stderr, "");
    }

    assert.deepEqual(
      await collectTempLitter(stateRoot),
      [],
      "reader/writer churn must not leave atomic-writer temp files behind",
    );
  } finally {
    await removeWithRetry(tempRoot);
  }
});
