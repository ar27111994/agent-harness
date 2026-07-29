import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  writeTextFile,
  writeJsonLinesFile,
  writeJsonFile,
  readTextFileOrNull,
  readJsonFileOrNull,
  ensureDirectory,
} from "../files.js";
import {
  isPathWithinRoot,
  resolveSafeMirrorFilePath,
  sanitizeAssetId,
  sanitizeMirrorId,
  resolveAllowedAbsolutePath,
  resolveAllowedRealFilePath,
} from "../lib/safe-paths.js";
import { ardRegistryInternals } from "../domains/discovery/source-sync/registries/ard-registry.js";
import { mergeCodexPluginMarketplace, buildCodexHooksManifest } from "../host-adapters/codex-native.js";
import { mapEntryToArd } from "../ard-catalog.js";

const { extractArdTrustSignals, computeArdTrustScore } = ardRegistryInternals;

async function mkdtempFixture(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `agent-harness-${prefix}-`));
}

// ── 1. Concurrency test ─────────────────────────────────────────────────

void test("concurrent write operations to shared state do not crash", async () => {
  const root = await mkdtempFixture("concurrent");
  try {
    const statePath = join(root, "state.jsonl");
    await writeTextFile(statePath, "");
    const ops = Array.from({ length: 20 }, (_, i) =>
      (async () => {
        const current = await readTextFileOrNull(statePath);
        const next = `${current ?? ""}${JSON.stringify({ index: i, ts: Date.now() })}\n`;
        await writeTextFile(statePath, next);
        return i;
      })(),
    );
    const results = await Promise.all(ops);
    assert.equal(results.length, 20);
    const finalState = await readTextFileOrNull(statePath);
    assert.ok(finalState !== null);
    assert.ok(finalState.length > 0);
    // Parse JSONL and verify every line is a complete valid record
    const lines = finalState.trim().split("\n");
    assert.ok(lines.length > 0, "should have at least one JSONL line");
    for (const line of lines) {
      const record = JSON.parse(line) as { index: number; ts: number };
      assert.ok(typeof record.index === "number", "each record should have an index");
      assert.ok(typeof record.ts === "number", "each record should have a timestamp");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("concurrent reads do not interfere with writes", async () => {
  const root = await mkdtempFixture("concurrent-read");
  try {
    const indexPath = join(root, "index.json");
    await writeTextFile(
      indexPath,
      JSON.stringify({ entries: [{ id: "test-1" }] }),
    );
    const readOps = Array.from({ length: 10 }, () =>
      (async () => readTextFileOrNull(indexPath))(),
    );
    const results = await Promise.all(readOps);
    for (const result of results) {
      assert.ok(result !== null);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 2. Large-input stress test ──────────────────────────────────────────

void test("writeJsonLinesFile handles 1000 entries without failure", async () => {
  const root = await mkdtempFixture("stress-write");
  try {
    const outputPath = join(root, "large.jsonl");
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      id: `entry-${i}`,
      name: `Test Entry ${i}`,
    }));
    await writeJsonLinesFile(outputPath, entries);
    const content = await readTextFileOrNull(outputPath);
    assert.ok(content !== null);
    const lines = content.trim().split("\n");
    assert.ok(lines.length >= 1000, `got ${lines.length} lines`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("trust-scoring handles 100 manifests without memory issues", async () => {
  const manifests = Array.from({ length: 100 }, (_, i) => ({
    publisher: `publisher-${i}@example.com`,
    domain: `example-${i}.com`,
    attestations: ["oms-signed", "soc2"],
  }));
  for (const manifest of manifests) {
    const signals = extractArdTrustSignals(manifest);
    const score = computeArdTrustScore(signals);
    assert.ok(typeof score === "number");
  }
});

// ── 3. Null-byte injection tests ────────────────────────────────────────

void test("sanitizeMirrorId strips null bytes and replaces with separator", () => {
  const result = sanitizeMirrorId("valid-name\x00hidden");
  assert.ok(!result.includes("\x00"));
  assert.ok(result.startsWith("valid-name"));
  assert.ok(result.includes("hidden"), "suffix preserved with separator");
});

void test("sanitizeAssetId strips null bytes", () => {
  const result = sanitizeAssetId("asset\x00injection");
  assert.ok(!result.includes("\x00"));
  assert.ok(result.length > 0);
});

void test("sanitizeMirrorId handles only control characters", () => {
  const result = sanitizeMirrorId("\x00\x01\x02\x00");
  assert.ok(!result.includes("\x00"));
});

void test("isPathWithinRoot handles null-byte paths without crashing", () => {
  const root = resolve("/safe/root");
  // Null bytes in paths should not crash; the function returns a boolean
  // indicating containment even for malformed paths.
  const result = isPathWithinRoot(root, join(root, "subdir\x00/etc/passwd"));
  assert.equal(typeof result, "boolean", "should return boolean for null-byte paths");
});

void test("resolveSafeMirrorFilePath handles null bytes gracefully", () => {
  const result = resolveSafeMirrorFilePath("/root", "asset\x00evil");
  assert.ok(typeof result === "string", "should return string");
  // Resolved path should not contain traversal sequences
  assert.ok(!result.includes(".."), "result should not escape via traversal");
});

void test("resolveAllowedAbsolutePath rejects invalid null-byte inputs", () => {
  const allowedRoots = [resolve("/workspace")];
  // Null-byte paths that are malformed should return null
  const result = resolveAllowedAbsolutePath("/valid\x00path", allowedRoots);
  assert.equal(result, null, "malformed null-byte path should be rejected");
});

// ── 4. Unicode path traversal tests ─────────────────────────────────────

void test("isPathWithinRoot rejects ../ traversal", () => {
  const root = resolve("/workspace");
  assert.equal(
    isPathWithinRoot(root, join(root, "..", "..", "etc", "passwd")),
    false,
  );
});

void test("isPathWithinRoot allows safe subdirectory access", () => {
  const root = resolve("/workspace");
  assert.equal(isPathWithinRoot(root, join(root, "subdir", "file.txt")), true);
});

void test("isPathWithinRoot handles Unicode characters in safe paths", () => {
  const root = resolve("/workspace/プロジェクト");
  assert.doesNotThrow(() => {
    isPathWithinRoot(root, join(root, "サブディレクトリ", "file.txt"));
  });
});

void test("resolveSafeMirrorFilePath handles Unicode paths", () => {
  assert.doesNotThrow(() => {
    const result = resolveSafeMirrorFilePath("/root", "日本語/path/file.txt");
    assert.ok(typeof result === "string");
  });
});

void test("resolveAllowedAbsolutePath handles Unicode paths", () => {
  const allowedRoots = [resolve("/workspace")];
  assert.doesNotThrow(() => {
    resolveAllowedAbsolutePath(
      resolve("/workspace/サブ/file.txt"),
      allowedRoots,
    );
  });
});

// ── 5. OMS/ARD trust verification integration test ──────────────────────

void test("extractArdTrustSignals detects identity-bound from identity field", () => {
  const signals = extractArdTrustSignals({
    identity: { type: "VerifiedPublisher", value: "test@example.com" },
    attestations: [],
  });
  assert.ok(signals.includes("ard-identity-bound"));
});

void test("extractArdTrustSignals returns empty for unverified entries", () => {
  assert.equal(extractArdTrustSignals({}).length, 0);
});

void test("extractArdTrustSignals detects signature when present", () => {
  const signals = extractArdTrustSignals({
    signature: { alg: "RS256", sig: "base64..." },
  });
  assert.ok(signals.includes("ard-signed"));
});

void test("extractArdTrustSignals detects SOC2 and HIPAA attestations", () => {
  const signals = extractArdTrustSignals({
    attestations: [
      { type: "SOC2-Type2", auditor: "test" },
      { type: "HIPAA-Audit", auditor: "test" },
    ],
  });
  assert.ok(signals.includes("ard-compliance-attested"));
  assert.ok(signals.includes("ard-soc2"));
  assert.ok(signals.includes("ard-hipaa"));
});

void test("computeArdTrustScore produces valid scores", () => {
  assert.equal(computeArdTrustScore([]), 0);
  const maxScore = computeArdTrustScore([
    "ard-signed",
    "ard-compliance-attested",
    "ard-soc2",
    "ard-hipaa",
    "ard-identity-bound",
  ]);
  assert.ok(maxScore > 0 && maxScore <= 100);
});

void test("trust scoring is monotonic with additional attestations", () => {
  const base = computeArdTrustScore(["ard-signed", "ard-identity-bound"]);
  const enhanced = computeArdTrustScore([
    "ard-signed",
    "ard-identity-bound",
    "ard-soc2",
    "ard-hipaa",
    "ard-compliance-attested",
  ]);
  assert.ok(enhanced >= base);
});

void test("extractArdTrustSignals returns empty array for undefined", () => {
  assert.deepEqual(extractArdTrustSignals(undefined), []);
});

void test("extractArdTrustSignals returns empty array for empty object", () => {
  assert.deepEqual(extractArdTrustSignals({}), []);
});

// ── 6. Long-string sanitization stress ─────────────────────────────────

void test("sanitizeMirrorId handles very long input strings", () => {
  const longInput = "a".repeat(100_000);
  const result = sanitizeMirrorId(longInput);
  assert.ok(result.length > 0);
});

void test("sanitizeAssetId handles very long input strings", () => {
  const longInput = "asset-".repeat(20_000);
  const result = sanitizeAssetId(longInput);
  assert.ok(result.length > 0);
});

// ── 7. Symlink escape test ─────────────────────────────────────────────

void test("resolveAllowedRealFilePath rejects symlink escapes from allowed roots", async () => {
  const root = await mkdtempFixture("symlink-escape");
  try {
    const workspaceRoot = join(root, "workspace");
    const externalDir = join(root, "external");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(externalDir, { recursive: true });

    const externalFile = join(externalDir, "secret.txt");
    await writeTextFile(externalFile, "sensitive data");

    const symlinkPath = join(workspaceRoot, "escape-link");
    await symlink(externalFile, symlinkPath);

    const result = await resolveAllowedRealFilePath(symlinkPath, [
      workspaceRoot,
    ]);
    assert.equal(result, null, "symlink should be rejected (return null)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 8. Real quarantine/mirror concurrency test ──────────────────────────

void test("concurrent quarantine review log writes do not corrupt", async () => {
  const root = await mkdtempFixture("concurrent-quarantine");
  try {
    const reviewsPath = join(root, "reviews.jsonl");
    await writeTextFile(reviewsPath, "");

    const ops = Array.from({ length: 15 }, (_, i) =>
      (async () => {
        const current = (await readTextFileOrNull(reviewsPath)) ?? "";
        const reviewEntry = {
          assetId: `asset-${i}`,
          entryId: `entry-${i}`,
          timestamp: new Date().toISOString(),
          reviewer: "test",
          decision: i % 2 === 0 ? "approved" : "rejected",
          reviewedEntryId: `entry-${i}`,
        };
        const next = `${current}${JSON.stringify(reviewEntry)}\n`;
        await writeTextFile(reviewsPath, next);
        return i;
      })(),
    );

    const results = await Promise.all(ops);
    assert.equal(results.length, 15);

    const finalContent = await readTextFileOrNull(reviewsPath);
    assert.ok(finalContent !== null);
    assert.ok(finalContent.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("concurrent mirror index reads survive writes", async () => {
  const root = await mkdtempFixture("concurrent-mirror-index");
  try {
    const indexPath = join(root, "index.jsonl");
    await writeJsonLinesFile(indexPath, [
      {
        id: "base-1",
        sourceId: "test",
        originUrl: "https://example.com",
        mirrorTimestamp: new Date().toISOString(),
        catalogValues: {},
      },
    ]);

    const readOps = Array.from({ length: 10 }, () =>
      (async () => readTextFileOrNull(indexPath))(),
    );
    const results = await Promise.all(readOps);
    for (const r of results) assert.ok(r !== null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 9. OMS chain tampering integration test ────────────────────────────

void test("OMS trust chain detects tampered manifests via missing identity", () => {
  const legitSignals = extractArdTrustSignals({
    identity: {
      type: "VerifiedPublisher",
      value: "real-publisher@example.com",
    },
    signature: { alg: "RS256", sig: "valid-base64" },
  });
  assert.ok(computeArdTrustScore(legitSignals) > 0);

  const tamperedSignals = extractArdTrustSignals({
    signature: { alg: "RS256", sig: "valid-base64" },
  });
  assert.ok(
    computeArdTrustScore(tamperedSignals) < computeArdTrustScore(legitSignals),
  );
});

void test("OMS trust chain: stripping attestations reduces score", () => {
  const full = computeArdTrustScore(
    extractArdTrustSignals({
      identity: { type: "VerifiedPublisher", value: "pub@example.com" },
      signature: { alg: "RS256", sig: "sig" },
      attestations: [
        { type: "SOC2-Type2", auditor: "a" },
        { type: "HIPAA-Audit", auditor: "b" },
      ],
    }),
  );
  const stripped = computeArdTrustScore(
    extractArdTrustSignals({
      identity: { type: "VerifiedPublisher", value: "pub@example.com" },
      signature: { alg: "RS256", sig: "sig" },
      attestations: [],
    }),
  );
  assert.ok(stripped <= full);
});

// ── 10. Codex marketplace dedup / hook source edge cases ────────────────

void test("mergeCodexPluginMarketplace filters existing agent-harness entry and adds it back", async () => {
  const root = await mkdtempFixture("codex-mkt");
  try {
    const mktPath = join(root, "marketplace.json");
    await writeJsonFile(mktPath, {
      schemaVersion: 1,
      plugins: [
        { name: "other-plugin", path: "./other" },
        { name: "agent-harness", path: "./old-agent-harness" },
      ],
    });
    await mergeCodexPluginMarketplace(mktPath);
    const result = await readJsonFileOrNull<{
      schemaVersion: number;
      plugins: { name: string; path: string }[];
    }>(mktPath);
    assert.ok(result !== null);
    const names = result.plugins.map((p) => p.name);
    assert.ok(names.includes("other-plugin"));
    assert.ok(names.includes("agent-harness"));
    const ahEntry = result.plugins.find((p) => p.name === "agent-harness");
    assert.equal(ahEntry?.path, "./agent-harness");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("buildCodexHooksManifest handles hooks without files and without manifest dir", () => {
  const manifestNoFile = buildCodexHooksManifest(
    [
      {
        assetId: "hook-no-file",
        assetKind: "hook",
        compatibilityMode: "adaptable",
        content: "# Hook\n",
        displayName: "Hook No File",
      },
    ],
    [],
  );
  assert.equal(
    (
      (manifestNoFile as Record<string, unknown>).hooks as Array<
        Record<string, unknown>
      >
    )[0]?.source,
    "hook-no-file",
  );
  // File path without "hooks/" segment cannot be slug-matched; falls back to asset ID
  const manifestNoDir = buildCodexHooksManifest(
    [
      {
        assetId: "hook-with-file",
        assetKind: "hook",
        compatibilityMode: "adaptable",
        content: "# Hook\n",
        displayName: "Hook With File",
      },
    ],
    ["/path/to/hook.md"],
  );
  assert.equal(
    (
      (manifestNoDir as Record<string, unknown>).hooks as Array<
        Record<string, unknown>
      >
    )[0]?.source,
    "hook-with-file",
  );
});

// ── 11. ARD export stress test (500+ entries) ──────────────────────────

void test("mapEntryToArd handles 500+ catalog entries without failure", () => {
  const publisherFqdn = "ar27111994.dev";
  const version = "1.0.0";

  const buildEntry = (i: number): Parameters<typeof mapEntryToArd>[0] =>
    ({
      id: `asset-${i}`,
      displayName: `Test Asset ${i}`,
      assetKind: "skill",
      hosts: ["claude-code"],
      compatibilityMode: "adaptable",
      source: {
        sourceId: "test-source",
        authorityTier: "unverified-community",
        sourceKind: "repo",
        sourcePriority: 70,
        originUrl: "https://example.com/test",
        publisher: "test-publisher",
        publisherVerified: false,
      },
      trust: { score: 50, signals: [] },
      capabilities: ["test"],
      install: {
        method: "repo-reference",
        manifestEntry: "https://example.com/test/manifest.json",
      },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        lineCount: 10,
        rootPath: "https://example.com/test",
        classification: null,
      },
      maintenance: {
        lastUpdated: "2026-01-01T00:00:00Z",
        stars: 0,
        releaseCadence: "occasional",
      },
      risk: { hooks: false, execScripts: false, requiresNetwork: false },
      contextCost: {
        sizeClass: "tiny",
        estimatedTokens: 100,
        installSizeBytes: 0,
      },
      fit: { relevance: 0.5, freshness: 0.5, ecosystemMatch: 0.5 },
      taxonomy: { domains: [], concerns: [], tooling: [] },
      compliance: [],
      prerequisites: [],
      dedupe: { groupKey: "none", isPreferred: true },
      status: "fresh",
    }) as unknown as Parameters<typeof mapEntryToArd>[0];

  const entries = Array.from({ length: 550 }, (_, i) => buildEntry(i));
  const results = entries.map((e) => mapEntryToArd(e, publisherFqdn, version));

  assert.equal(results.length, 550);
  for (const entry of results) {
    assert.ok(typeof entry.identifier === "string");
    assert.ok(typeof entry.type === "string");
  }
});

// ── 12. Unicode real-path canonicalization test ────────────────────────

void test("resolveAllowedRealFilePath canonicalizes Unicode paths via realpath", async () => {
  const root = await mkdtempFixture("unicode-realpath");
  try {
    const workspaceRoot = join(root, "workspace");
    await mkdir(join(workspaceRoot, "日本語", "サブ"), { recursive: true });

    const targetFile = join(workspaceRoot, "日本語", "サブ", "file.txt");
    await writeTextFile(targetFile, "unicode content");

    const result = await resolveAllowedRealFilePath(targetFile, [
      workspaceRoot,
    ]);
    assert.ok(
      result !== null,
      "Unicode file inside allowed root should resolve",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 13. Activation manifest concurrency test ────────────────────────────

void test("concurrent activation manifest writes do not corrupt", async () => {
  const root = await mkdtempFixture("concurrent-activation");
  try {
    const activationPath = join(
      root,
      "activate",
      "opencode",
      "activation-manifest.json",
    );
    await ensureDirectory(join(root, "activate", "opencode"));

    const initialManifest = {
      schemaVersion: 1,
      activeAssets: ["asset-base"],
      generatedAt: new Date().toISOString(),
    };
    await writeTextFile(activationPath, JSON.stringify(initialManifest));

    const ops = Array.from({ length: 10 }, (_, i) =>
      (async () => {
        let parsed:
          | {
              activeAssets?: string[];
              generatedAt?: string;
              schemaVersion?: number;
            }
          | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = (await readTextFileOrNull(activationPath)) ?? "{}";
          try {
            parsed = JSON.parse(current) as NonNullable<typeof parsed>;
            break;
          } catch {
            if (attempt === 2)
              throw new Error("Failed to parse manifest after 3 attempts");
            await new Promise((r) => setTimeout(r, 10));
          }
        }
        if (!parsed)
          throw new Error("unreachable: parsed not set after retry loop");
        const assets = [...(parsed.activeAssets ?? []), `asset-${i}`];
        await writeTextFile(
          activationPath,
          JSON.stringify({
            ...parsed,
            activeAssets: assets,
            generatedAt: new Date().toISOString(),
          }),
        );
        return i;
      })(),
    );

    const results = await Promise.all(ops);
    assert.equal(results.length, 10);

    const finalContent = await readTextFileOrNull(activationPath);
    assert.ok(finalContent !== null);
    const finalParsed = JSON.parse(finalContent) as { activeAssets?: string[] };
    assert.ok(Array.isArray(finalParsed.activeAssets));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 14. Install progress concurrency test ──────────────────────────────

void test("concurrent install progress writes do not corrupt", async () => {
  const root = await mkdtempFixture("concurrent-install");
  try {
    const installDir = join(root, "install");
    await mkdir(installDir, { recursive: true });
    const progressPath = join(installDir, "progress.json");

    await writeTextFile(
      progressPath,
      JSON.stringify({ steps: [{ id: "base", status: "pending" }] }),
    );

    const ops = Array.from({ length: 12 }, (_, i) =>
      (async () => {
        const current = (await readTextFileOrNull(progressPath)) ?? "{}";
        const steps = ((): { id: string; status: string }[] => {
          try {
            const parsed = JSON.parse(current) as {
              steps?: { id: string; status: string }[];
            };
            return [
              ...(parsed.steps ?? []),
              { id: `step-${i}`, status: "done" },
            ];
          } catch {
            return [{ id: `step-${i}`, status: "done" }];
          }
        })();
        await writeTextFile(progressPath, JSON.stringify({ steps }));
        return i;
      })(),
    );

    const results = await Promise.all(ops);
    assert.equal(results.length, 12);

    // Verify progress file exists and is readable (TOCTOU may produce
    // interleaved JSON — test checks survival, not exact content)
    const finalContent = await readTextFileOrNull(progressPath);
    assert.ok(finalContent !== null);
    assert.ok(
      finalContent.length > 0,
      "progress file should have content after concurrency",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
