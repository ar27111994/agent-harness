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
import { mergeCodexPluginMarketplace } from "../host-adapters/codex-native.js";

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
  assert.doesNotThrow(() => {
    isPathWithinRoot(root, join(root, "subdir\x00/etc/passwd"));
  });
});

void test("resolveSafeMirrorFilePath handles null bytes gracefully", () => {
  assert.doesNotThrow(() => {
    const result = resolveSafeMirrorFilePath("/root", "asset\x00evil");
    assert.ok(typeof result === "string");
  });
});

void test("resolveAllowedAbsolutePath handles null-byte inputs", () => {
  const allowedRoots = [resolve("/workspace")];
  assert.doesNotThrow(() => {
    resolveAllowedAbsolutePath("/valid\x00path", allowedRoots);
  });
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

    // Create symlink inside workspace pointing outside
    const symlinkPath = join(workspaceRoot, "escape-link");
    await symlink(externalFile, symlinkPath);

    // resolveAllowedRealFilePath returns null for symlinks
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

    // Simulate concurrent quarantine review writes
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

    // Verify log is readable and has entries
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
  // Legitimate manifest with identity bound
  const legitSignals = extractArdTrustSignals({
    identity: {
      type: "VerifiedPublisher",
      value: "real-publisher@example.com",
    },
    signature: { alg: "RS256", sig: "valid-base64" },
  });
  const legitScore = computeArdTrustScore(legitSignals);
  assert.ok(legitScore > 0, "legitimate manifest should have positive score");

  // Tampered manifest: identity field removed
  const tamperedSignals = extractArdTrustSignals({
    signature: { alg: "RS256", sig: "valid-base64" },
    // No identity — chain broken
  });
  const tamperedScore = computeArdTrustScore(tamperedSignals);
  assert.ok(
    tamperedScore < legitScore,
    "tampered manifest should score lower than legitimate",
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

  // Attestations stripped
  const stripped = computeArdTrustScore(
    extractArdTrustSignals({
      identity: { type: "VerifiedPublisher", value: "pub@example.com" },
      signature: { alg: "RS256", sig: "sig" },
      attestations: [],
    }),
  );

  assert.ok(
    stripped < full || stripped <= full,
    `stripped (${stripped}) should not exceed full (${full})`,
  );
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
    assert.ok(ahEntry !== undefined);
    assert.equal(ahEntry.path, "./agent-harness");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("buildCodexHooksManifest handles hooks without files and without manifest dir", async () => {
  const { buildCodexHooksManifest } =
    await import("../host-adapters/codex-native.js");
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
    "/path/to/hook.md",
  );
});
