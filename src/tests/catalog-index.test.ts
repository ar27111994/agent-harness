/**
 * Tests for the `discover index` two-phase catalog architecture (#289).
 *
 * Validates:
 * 1. `isCatalogIndexFresh` returns false when no catalog-index files exist.
 * 2. `isCatalogIndexFresh` returns true when the meta file is fresh.
 * 3. `isCatalogIndexFresh` returns false when the meta file is stale.
 * 4. `isCatalogIndexFresh` falls back to JSONL mtime when meta file is absent.
 * 5. `writeCatalogIndexMeta` writes valid JSON with the correct shape.
 * 6. The staleness threshold respects `AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS`.
 * 7. The `assertCatalogIndexMeta` validator rejects invalid shapes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isCatalogIndexFresh,
  writeCatalogIndexMeta,
  catalogIndexInternals,
} from "../domains/discovery/catalog-index.js";
import { runtimeConfigInternals } from "../config/runtime.js";

// ─── Fixture helpers ────────────────────────────────────────────────────────

async function makeProjectRoot(): Promise<string> {
  const root = join(
    tmpdir(),
    `ah-catalog-index-test-${process.pid}-${Date.now()}`,
  );
  await mkdir(join(root, "discover", "output"), { recursive: true });
  return root;
}

async function writeMetaFile(
  projectRoot: string,
  builtAt: Date,
  entryCount = 0,
): Promise<void> {
  const meta = { builtAt: builtAt.toISOString(), entryCount };
  await writeFile(
    join(projectRoot, "discover", "output", "catalog-index-meta.json"),
    JSON.stringify(meta),
  );
  // The freshness check now also verifies the JSONL is present when meta exists.
  // Write an empty JSONL alongside every meta fixture so the stat succeeds.
  await writeFile(
    join(projectRoot, "discover", "output", "catalog-index.jsonl"),
    "",
  );
}

async function writeFakeIndexJsonl(
  projectRoot: string,
  builtAt: Date,
): Promise<void> {
  // Write an empty-ish JSONL; mtime is what matters for the fallback path.
  await writeFile(
    join(projectRoot, "discover", "output", "catalog-index.jsonl"),
    "",
  );
  // Simulate an older mtime by truncating the file and writing a fake byte.
  const { utimes } = await import("node:fs/promises");
  await utimes(
    join(projectRoot, "discover", "output", "catalog-index.jsonl"),
    builtAt,
    builtAt,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

void test("isCatalogIndexFresh — returns false when no files exist", async () => {
  const root = await makeProjectRoot();
  try {
    // No meta and no JSONL → not fresh.
    const fresh = await isCatalogIndexFresh(root);
    assert.equal(fresh, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("isCatalogIndexFresh — returns true for a fresh meta file (< maxAgeDays)", async () => {
  const root = await makeProjectRoot();
  try {
    // Built 1 hour ago; default max is 7 days.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await writeMetaFile(root, oneHourAgo, 42);

    const fresh = await isCatalogIndexFresh(root);
    assert.equal(fresh, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("isCatalogIndexFresh — returns false for a stale meta file (> maxAgeDays)", async () => {
  const root = await makeProjectRoot();
  try {
    // Built 10 days ago; default max is 7 days.
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await writeMetaFile(root, tenDaysAgo, 100);

    const fresh = await isCatalogIndexFresh(root);
    assert.equal(fresh, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("isCatalogIndexFresh — falls back to JSONL mtime when meta absent", async () => {
  const root = await makeProjectRoot();
  try {
    // Write only the JSONL (no meta), with a recent mtime.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await writeFakeIndexJsonl(root, twoHoursAgo);

    const fresh = await isCatalogIndexFresh(root);
    assert.equal(fresh, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("isCatalogIndexFresh — respects AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS", async (ctx) => {
  const root = await makeProjectRoot();
  const priorAgeDays = process.env.AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS;
  process.env.AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS = "1";
  runtimeConfigInternals.resetCacheForTesting();
  ctx.after(() => {
    if (priorAgeDays === undefined) {
      delete process.env.AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS;
    } else {
      process.env.AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS = priorAgeDays;
    }
    runtimeConfigInternals.resetCacheForTesting();
  });

  try {
    // Built 2 days ago; with max = 1 day this is stale.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await writeMetaFile(root, twoDaysAgo, 50);

    const fresh = await isCatalogIndexFresh(root);
    assert.equal(
      fresh,
      false,
      "2-day-old index should be stale with 1-day threshold",
    );

    // Now write a fresh meta (30 minutes ago) — should be fresh with 1-day threshold.
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    await writeMetaFile(root, thirtyMinAgo, 50);

    const freshNow = await isCatalogIndexFresh(root);
    assert.equal(
      freshNow,
      true,
      "30-minute-old index should be fresh with 1-day threshold",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeCatalogIndexMeta — writes a valid meta file", async () => {
  const root = await makeProjectRoot();
  try {
    const before = Date.now();
    await writeCatalogIndexMeta(root, 999);
    const after = Date.now();

    const metaRaw = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(
        join(root, "discover", "output", "catalog-index-meta.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;

    assert.equal(metaRaw.entryCount, 999);
    assert.equal(typeof metaRaw.builtAt, "string");

    const builtAtMs = new Date(metaRaw.builtAt as string).getTime();
    assert.ok(
      builtAtMs >= before && builtAtMs <= after,
      "builtAt should be within the test window",
    );

    // The validator accepts this shape — confirmed by the absence of a throw.
    // (The throws tests below cover the rejection paths exhaustively.)
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("assertCatalogIndexMeta — rejects missing builtAt", () => {
  assert.throws(
    () =>
      catalogIndexInternals.assertCatalogIndexMeta({ entryCount: 0 }, "ctx"),
    /Invalid CatalogIndexMeta/,
  );
});

void test("assertCatalogIndexMeta — rejects missing entryCount", () => {
  assert.throws(
    () =>
      catalogIndexInternals.assertCatalogIndexMeta(
        { builtAt: new Date().toISOString() },
        "ctx",
      ),
    /Invalid CatalogIndexMeta/,
  );
});

void test("assertCatalogIndexMeta — rejects null", () => {
  assert.throws(
    () => catalogIndexInternals.assertCatalogIndexMeta(null, "ctx"),
    /Invalid CatalogIndexMeta/,
  );
});

void test("isCatalogIndexFresh — returns false when meta present but JSONL absent (lines 58-59)", async () => {
  const root = await makeProjectRoot();
  try {
    // Write meta-only (no catalog-index.jsonl) — simulates a state where the
    // meta file was written but the JSONL snapshot was deleted or never flushed.
    // isCatalogIndexFresh must stat the JSONL and return false on ENOENT.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await writeFile(
      join(root, "discover", "output", "catalog-index-meta.json"),
      JSON.stringify({ builtAt: oneHourAgo.toISOString(), entryCount: 5 }),
    );
    // Deliberately omit writing catalog-index.jsonl.

    const fresh = await isCatalogIndexFresh(root);
    assert.equal(
      fresh,
      false,
      "must be false when meta exists but JSONL is missing",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
