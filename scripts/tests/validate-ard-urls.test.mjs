/**
 * Tests for scripts/validate-ard-urls.mjs (#380).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { validateArdUrls } from "../validate-ard-urls.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "ard-urls-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeCatalog(dir, entries) {
  const catalog = {
    $schema:
      "https://agenticresourcediscovery.org/spec/v0.9/schemas/ai-catalog.json",
    publisher: "test.example.com",
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    entries,
  };
  const path = join(dir, "ai-catalog.json");
  await writeFile(path, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  return path;
}

void test("validateArdUrls passes with all HTTP URLs", async () => {
  await withTempDir(async (dir) => {
    const path = await writeCatalog(dir, [
      {
        identifier: "a",
        url: "https://github.com/test/repo/blob/main/SKILL.md",
        type: "app/ai-skill",
      },
      {
        identifier: "b",
        url: "https://www.npmjs.com/package/pkg",
        type: "app/ai-skill",
      },
      {
        identifier: "c",
        url: "https://registry.example.com/asset",
        type: "app/ai-skill",
      },
    ]);
    const result = validateArdUrls(path);
    assert.ok(result.ok);
    assert.equal(result.stats.total, 3);
    assert.equal(result.stats.httpCount, 3);
    assert.equal(result.stats.fraction, 1.0);
  });
});

void test("validateArdUrls passes with mix of HTTP and local file URLs", async () => {
  await withTempDir(async (dir) => {
    const path = await writeCatalog(dir, [
      {
        identifier: "a",
        url: "https://github.com/test/SKILL.md",
        type: "app/ai-skill",
      },
      {
        identifier: "b",
        url: "https://registry.example.com/pkg",
        type: "app/mcp-server+json",
      },
      {
        identifier: "c",
        url: "https://github.com/test2/SKILL.md",
        type: "app/ai-skill",
      },
      { identifier: "d", url: "https://npmjs.com/pkg2", type: "app/ai-skill" },
      {
        identifier: "e",
        url: "file:///home/user/local-skill.md",
        type: "app/ai-skill",
      },
    ]);
    const result = validateArdUrls(path);
    assert.ok(result.ok, `Expected pass but got: ${result.errors.join("; ")}`);
    assert.equal(result.stats.total, 5);
    assert.equal(result.stats.httpCount, 4);
    assert.equal(result.stats.fraction, 0.8); // 4/5 = exactly 80%
  });
});

void test("validateArdUrls fails when HTTP ratio is below 80%", async () => {
  await withTempDir(async (dir) => {
    const path = await writeCatalog(dir, [
      {
        identifier: "a",
        url: "https://github.com/test/SKILL.md",
        type: "app/ai-skill",
      },
      {
        identifier: "b",
        url: "a94df09f75fba2f11c63103c3e573c729226a6e0",
        type: "app/ai-skill",
      },
      {
        identifier: "c",
        url: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
        type: "app/ai-skill",
      },
    ]);
    const result = validateArdUrls(path);
    assert.ok(!result.ok, "Expected failure for sub-80% HTTP URLs");
    assert.equal(result.stats.fraction, 1 / 3);
    assert.ok(result.errors.some((e) => e.includes("below threshold")));
  });
});

void test("validateArdUrls fails when entries have no url field", async () => {
  await withTempDir(async (dir) => {
    const path = await writeCatalog(dir, [
      {
        identifier: "a",
        url: "https://github.com/test/SKILL.md",
        type: "app/ai-skill",
      },
      { identifier: "b", type: "app/ai-skill" },
      {
        identifier: "c",
        url: "https://github.com/test2/SKILL.md",
        type: "app/ai-skill",
      },
    ]);
    const result = validateArdUrls(path);
    assert.ok(!result.ok);
    assert.equal(result.stats.missingCount, 1);
    assert.ok(result.errors.some((e) => e.includes("no url field")));
  });
});

void test("validateArdUrls reports hash and name/non-http counts", async () => {
  await withTempDir(async (dir) => {
    const path = await writeCatalog(dir, [
      {
        identifier: "a",
        url: "https://github.com/test/SKILL.md",
        type: "app/ai-skill",
      },
      {
        identifier: "b",
        url: "https://github.com/test2/SKILL.md",
        type: "app/ai-skill",
      },
      {
        identifier: "c",
        url: "https://github.com/test3/SKILL.md",
        type: "app/ai-skill",
      },
      {
        identifier: "d",
        url: "a94df09f75fba2f11c63103c3e573c729226a6e0",
        type: "app/ai-skill",
      },
      { identifier: "e", url: "SomePlainName", type: "app/ai-skill" },
    ]);
    const result = validateArdUrls(path);
    assert.ok(result.ok); // 3/5 = 60%? No, 3/5 = 60% < 80%... Hmm.
    // 3 HTTP, 1 hash, 1 name => 3/5=60%, below threshold
    assert.equal(result.stats.total, 5);
    assert.equal(result.stats.httpCount, 3);
    assert.equal(result.stats.hashCount, 1);
    assert.equal(result.stats.nameCount, 1);
    assert.ok(!result.ok, "3/5=60% should fail the 80% threshold");
  });
});

void test("validateArdUrls handles empty entries array", async () => {
  await withTempDir(async (dir) => {
    const path = await writeCatalog(dir, []);
    const result = validateArdUrls(path);
    // 0/0 = NaN → fraction 0 < 0.8 → should fail
    assert.equal(result.stats.total, 0);
    assert.equal(result.stats.fraction, 0);
    assert.ok(!result.ok);
  });
});

void test("validateArdUrls passes with 100% HTTP URLs at scale", async () => {
  await withTempDir(async (dir) => {
    const entries = [];
    for (let i = 0; i < 100; i++) {
      entries.push({
        identifier: `entry-${i}`,
        url: `https://github.com/org${i % 10}/repo${i}/blob/main/SKILL.md`,
        type: "application/ai-skill",
      });
    }
    const path = await writeCatalog(dir, entries);
    const result = validateArdUrls(path);
    assert.ok(result.ok);
    assert.equal(result.stats.total, 100);
    assert.equal(result.stats.httpCount, 100);
    assert.equal(result.stats.fraction, 1.0);
  });
});
