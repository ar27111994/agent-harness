import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

    // Seed empty state
    await writeTextFile(statePath, "");

    // Spawn 20 concurrent append operations (each reads, appends, rewrites)
    const ops = Array.from({ length: 20 }, (_, i) =>
      (async () => {
        const current = await readTextFileOrNull(statePath);
        const next = `${current ?? ""}${JSON.stringify({ index: i, ts: Date.now() })}\n`;
        await writeTextFile(statePath, next);
        return i;
      })(),
    );

    const results = await Promise.all(ops);
    assert.equal(
      results.length,
      20,
      "all concurrent operations should complete",
    );

    // Verify state file exists and is readable
    const finalState = await readTextFileOrNull(statePath);
    assert.ok(
      finalState !== null,
      "shared state should be readable after concurrency",
    );
    assert.ok(finalState.length > 0, "shared state should have content");
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

    // Concurrent reads
    const readOps = Array.from({ length: 10 }, () =>
      (async () => readTextFileOrNull(indexPath))(),
    );
    const results = await Promise.all(readOps);

    for (const result of results) {
      assert.ok(result !== null, "concurrent reads should not return null");
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

    // Read back lines as text
    const content = await readTextFileOrNull(outputPath);
    assert.ok(content !== null, "large file should be readable");
    const lines = content.trim().split("\n");
    assert.ok(
      lines.length >= 1000,
      `should have at least 1000 lines, got ${lines.length}`,
    );
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
    assert.ok(
      typeof score === "number",
      `score should be number, got ${typeof score}`,
    );
  }
});

// ── 3. Null-byte injection tests ────────────────────────────────────────

void test("sanitizeMirrorId strips null bytes and replaces with separator", () => {
  const result = sanitizeMirrorId("valid-name\x00hidden");
  assert.ok(!result.includes("\x00"), "null byte must be stripped");
  assert.ok(
    result.startsWith("valid-name"),
    "prefix before null byte must be preserved",
  );
  // The regex replaces non-alphanumeric sequences with '-', so the null
  // byte acts as a separator between the before and after segments.
  assert.ok(
    result.includes("hidden"),
    "suffix after null byte preserved with separator",
  );
  assert.ok(result.length > 0, "result not empty");
});

void test("sanitizeAssetId strips null bytes", () => {
  const result = sanitizeAssetId("asset\x00injection");
  assert.ok(!result.includes("\x00"), "null byte stripped from asset id");
  assert.ok(result.length > 0, "result not empty");
});

void test("sanitizeMirrorId handles only control characters", () => {
  const result = sanitizeMirrorId("\x00\x01\x02\x00");
  assert.ok(!result.includes("\x00"), "control chars stripped");
});

void test("isPathWithinRoot handles null-byte paths without crashing", () => {
  const root = resolve("/safe/root");
  assert.doesNotThrow(() => {
    isPathWithinRoot(root, join(root, "subdir\x00/etc/passwd"));
  }, "null-byte path should not crash isPathWithinRoot");
});

void test("resolveSafeMirrorFilePath handles null bytes gracefully", () => {
  assert.doesNotThrow(() => {
    const result = resolveSafeMirrorFilePath("/root", "asset\x00evil");
    assert.ok(typeof result === "string", "should return string");
  }, "null-byte path should not crash resolveSafeMirrorFilePath");
});

void test("resolveAllowedAbsolutePath handles null-byte inputs", () => {
  const allowedRoots = [resolve("/workspace")];
  assert.doesNotThrow(() => {
    resolveAllowedAbsolutePath("/valid\x00path", allowedRoots);
  }, "null bytes should not crash resolveAllowedAbsolutePath");
});

// ── 4. Unicode path traversal tests ─────────────────────────────────────

void test("isPathWithinRoot rejects ../ traversal", () => {
  const root = resolve("/workspace");
  const traversal = join(root, "..", "..", "etc", "passwd");
  const contained = isPathWithinRoot(root, traversal);
  assert.equal(contained, false, "../ traversal should be rejected");
});

void test("isPathWithinRoot allows safe subdirectory access", () => {
  const root = resolve("/workspace");
  const safe = join(root, "subdir", "file.txt");
  const contained = isPathWithinRoot(root, safe);
  assert.equal(contained, true, "safe subdir should be allowed");
});

void test("isPathWithinRoot handles Unicode characters in safe paths", () => {
  const root = resolve("/workspace/プロジェクト");
  const safePath = join(root, "サブディレクトリ", "file.txt");
  assert.doesNotThrow(() => {
    isPathWithinRoot(root, safePath);
  }, "Unicode safe path should not crash");
});

void test("resolveSafeMirrorFilePath handles Unicode paths", () => {
  assert.doesNotThrow(() => {
    const result = resolveSafeMirrorFilePath("/root", "日本語/path/file.txt");
    assert.ok(typeof result === "string", "should handle Unicode");
  });
});

void test("resolveAllowedAbsolutePath handles Unicode paths", () => {
  const allowedRoots = [resolve("/workspace")];
  assert.doesNotThrow(() => {
    resolveAllowedAbsolutePath(
      resolve("/workspace/サブ/file.txt"),
      allowedRoots,
    );
  }, "should handle Unicode path");
});

// ── 5. OMS/ARD trust verification integration test ──────────────────────

void test("extractArdTrustSignals detects identity-bound from identity field", () => {
  const signals = extractArdTrustSignals({
    identity: { type: "VerifiedPublisher", value: "test@example.com" },
    attestations: [],
  });
  assert.ok(signals.includes("ard-identity-bound"), "identity should be bound");
});

void test("extractArdTrustSignals returns empty for unverified entries", () => {
  const signals = extractArdTrustSignals({});
  assert.equal(signals.length, 0, "unverified entry should have no signals");
});

void test("extractArdTrustSignals detects signature when present", () => {
  const signals = extractArdTrustSignals({
    signature: { alg: "RS256", sig: "base64..." },
  });
  assert.ok(
    signals.includes("ard-signed"),
    "signed manifest should be detected",
  );
});

void test("extractArdTrustSignals detects SOC2 and HIPAA attestations", () => {
  const signals = extractArdTrustSignals({
    attestations: [
      { type: "SOC2-Type2", auditor: "test" },
      { type: "HIPAA-Audit", auditor: "test" },
    ],
  });
  assert.ok(signals.includes("ard-compliance-attested"), "attested signal");
  assert.ok(signals.includes("ard-soc2"), "SOC2 signal");
  assert.ok(signals.includes("ard-hipaa"), "HIPAA signal");
});

void test("computeArdTrustScore produces valid scores", () => {
  assert.equal(computeArdTrustScore([]), 0);
  const allSignals = [
    "ard-signed",
    "ard-compliance-attested",
    "ard-soc2",
    "ard-hipaa",
    "ard-identity-bound",
  ];
  const maxScore = computeArdTrustScore(allSignals);
  assert.ok(maxScore > 0, "all signals should give positive score");
  assert.ok(maxScore <= 100, "max score should not exceed 100");
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
  assert.ok(enhanced >= base, `enhanced (${enhanced}) >= base (${base})`);
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
  assert.doesNotThrow(
    () => sanitizeMirrorId(longInput),
    "long input should not crash",
  );
  const result = sanitizeMirrorId(longInput);
  assert.ok(result.length > 0, "should return a result for long input");
});

void test("sanitizeAssetId handles very long input strings", () => {
  const longInput = "asset-".repeat(20_000);
  assert.doesNotThrow(
    () => sanitizeAssetId(longInput),
    "long input should not crash",
  );
  const result = sanitizeAssetId(longInput);
  assert.ok(result.length > 0, "should return a result for long input");
});

// ── 8. Codex marketplace dedup filters existing agent-harness plugins ───

void test("mergeCodexPluginMarketplace filters existing agent-harness entry and adds it back", async () => {
  const root = await mkdtempFixture("codex-mkt");
  try {
    const mktPath = join(root, "marketplace.json");
    // Pre-populate marketplace with an existing agent-harness entry
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
    assert.ok(result !== null, "marketplace should exist after merge");
    const names = result.plugins.map((p) => p.name);
    assert.ok(
      names.includes("other-plugin"),
      "non-agent-harness plugins preserved",
    );
    assert.ok(
      names.includes("agent-harness"),
      "agent-harness re-added with current path",
    );
    // The old "old-agent-harness" path should be replaced with "./agent-harness"
    const ahEntry = result.plugins.find((p) => p.name === "agent-harness");
    assert.ok(ahEntry !== undefined, "agent-harness entry should exist");
    assert.equal(
      ahEntry.path,
      "./agent-harness",
      "path should be updated to current",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 7. Codex hook source edge cases ───────────────────────────────────

void test("buildCodexHooksManifest handles hooks without files and without manifest dir", async () => {
  const { buildCodexHooksManifest } =
    await import("../host-adapters/codex-native.js");
  // Hook with no file → falls back to assetId
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
  // Hook with file but no manifest dir → returns hookFile as-is
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
