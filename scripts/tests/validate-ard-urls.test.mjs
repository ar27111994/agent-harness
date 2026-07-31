/**
 * Tests for scripts/validate-ard-urls.mjs (#380).
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  main,
  runCliIfDirect,
  validateArdUrls,
} from "../validate-ard-urls.mjs";

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
    assert.ok(result.errors.some((e) => e.includes("missing or empty url")));
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
    // 3 HTTP, 1 hash, 1 name => 3/5 = 60%, below 80% threshold
    assert.ok(!result.ok, "3/5=60% should fail the 80% threshold");
    assert.equal(result.stats.total, 5);
    assert.equal(result.stats.httpCount, 3);
    assert.equal(result.stats.hashCount, 1);
    assert.equal(result.stats.nameCount, 1);
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

void test("validateArdUrls fails when entries is not an array", async () => {
  await withTempDir(async (dir) => {
    const rawPath = join(dir, "ai-catalog.json");
    await writeFile(
      rawPath,
      JSON.stringify({
        $schema: "https://example.com/schema.json",
        publisher: "test",
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        entries: { not: "an array" },
      }) + "\n",
      "utf8",
    );
    const result = validateArdUrls(rawPath);
    assert.ok(!result.ok);
    assert.ok(
      result.errors.some((e) => e.includes("missing or has no entries array")),
    );
  });
});

void test("validateArdUrls main function succeeds with valid catalog", async () => {
  await withTempDir(async (dir) => {
    const wellKnown = join(dir, ".well-known");
    await mkdir(wellKnown, { recursive: true });
    await writeFile(
      join(wellKnown, "ai-catalog.json"),
      JSON.stringify({
        $schema: "https://example.com/schema.json",
        publisher: "test",
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        entries: [
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
            url: "https://github.com/test4/SKILL.md",
            type: "app/ai-skill",
          },
          {
            identifier: "e",
            url: "https://github.com/test5/SKILL.md",
            type: "app/ai-skill",
          },
        ],
      }) + "\n",
      "utf8",
    );

    const prevExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const result = main({ cwd: dir });
      assert.ok(result.ok);
      assert.equal(result.stats.total, 5);
      assert.equal(result.stats.httpCount, 5);
    } finally {
      process.exitCode = prevExitCode;
    }
  });
});

void test("validateArdUrls main function handles missing catalog gracefully", async () => {
  await withTempDir(async (dir) => {
    const result = main({ cwd: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => e.includes("Failed to read")));
  });
});

void test("validateArdUrls main function reports error for failing catalog", async () => {
  await withTempDir(async (dir) => {
    const wellKnown = join(dir, ".well-known");
    await mkdir(wellKnown, { recursive: true });
    // Write a catalog with only hash URLs — well below 80% threshold
    await writeFile(
      join(wellKnown, "ai-catalog.json"),
      JSON.stringify({
        $schema: "https://example.com/schema.json",
        publisher: "test",
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        entries: [
          {
            identifier: "a",
            url: "a94df09f75fba2f11c63103c3e573c729226a6e0",
            type: "app/ai-skill",
          },
          {
            identifier: "b",
            url: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
            type: "app/ai-skill",
          },
        ],
      }) + "\n",
      "utf8",
    );

    // main() should set process.exitCode and return non-ok result
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const result = main({ cwd: dir });
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e) => e.includes("below threshold")));
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = prevExitCode;
    }
  });
});

void test("runCliIfDirect returns main result when guard is true", async () => {
  await withTempDir(async (dir) => {
    const wellKnown = join(dir, ".well-known");
    await mkdir(wellKnown, { recursive: true });
    await writeFile(
      join(wellKnown, "ai-catalog.json"),
      JSON.stringify({
        $schema: "https://example.com/schema.json",
        publisher: "test",
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        entries: [
          {
            identifier: "a",
            url: "https://github.com/test/SKILL.md",
            type: "app/ai-skill",
          },
        ],
      }) + "\n",
      "utf8",
    );

    const result = runCliIfDirect(true, { cwd: dir });
    assert.ok(result !== undefined);
    assert.ok(result.ok);
    assert.equal(result.stats.total, 1);
  });
});

void test("runCliIfDirect returns undefined when guard is false", () => {
  const result = runCliIfDirect(false);
  assert.equal(result, undefined);
});

void test("main uses process.cwd fallback when no cwd option provided", async () => {
  // Verify that main() can be called without options — exercises the
  // `options.cwd ?? process.cwd()` fallback path at line 86.
  // This relies on the project's own .well-known/ai-catalog.json being valid.
  const prevExitCode = process.exitCode;
  const origLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const result = main();
    // The project catalog should be valid (>=80% HTTP URLs)
    assert.ok(result.ok);
    assert.ok(result.stats.total > 0);
    assert.ok(result.stats.fraction >= 0.8);
  } finally {
    console.log = origLog;
    process.exitCode = prevExitCode;
  }
});

void test("validateArdUrls handles missing catalog file gracefully", async () => {
  const result = validateArdUrls("/nonexistent/path/to/catalog.json");
  assert.ok(!result.ok);
  assert.ok(result.stats !== undefined);
  assert.equal(result.stats.total, 0);
  assert.ok(result.errors.some((e) => e.includes("Failed to read")));
});

void test("validateArdUrls handles malformed JSON gracefully", async () => {
  await withTempDir(async (dir) => {
    const wellKnown = join(dir, ".well-known");
    await mkdir(wellKnown, { recursive: true });
    const path = join(wellKnown, "ai-catalog.json");
    await writeFile(path, "not valid json {{{", "utf8");
    const result = validateArdUrls(path);
    assert.ok(!result.ok);
    assert.ok(result.stats !== undefined);
    assert.equal(result.stats.total, 0);
    assert.ok(result.errors.some((e) => e.includes("Failed to parse")));
  });
});
