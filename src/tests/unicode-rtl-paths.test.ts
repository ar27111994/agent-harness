/**
 * RTL/unicode path and identity suite (#428 hardening backlog).
 *
 * Dedicated coverage for right-to-left scripts (Arabic, Hebrew), CJK,
 * combining marks, zero-width/format characters, emoji, and full-width
 * confusables across the path/identity surface: safe-path resolution,
 * mirror/asset id sanitization, posix path conversion, lifecycle
 * fingerprints (including punycode normalization of non-ASCII domains),
 * and real filesystem round-trips through unicode directory names.
 *
 * The security contract under test: unicode is data, never a traversal
 * bypass — every path that escapes its root is refused regardless of
 * script, and every id-derived filename is ASCII-safe and deterministic.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildAssetLifecycleFingerprint,
  buildAssetLifecycleFingerprintReport,
} from "../domains/discovery/asset-fingerprints.js";
import {
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
  toRelativePosixPath,
  writeJsonFile,
  writeJsonLinesFile,
} from "../files.js";
import {
  isPathWithinRoot,
  resolveAllowedAbsolutePath,
  resolveAllowedRealFilePath,
  resolveSafeMirrorFilePath,
  sanitizeAssetId,
  sanitizeMirrorId,
} from "../lib/safe-paths.js";
import type { AssetCatalogEntry, MirrorIndexEntry } from "../types.js";

const ARABIC_PATH = "ملفات";
const HEBREW_PATH = "תיקייה";
const CJK_PATH = "資料";
const EMOJI_PATH = "🚀-assets";
const COMBINING_NAME = "cafe\u0301-config"; // é as e + combining acute
const ZERO_WIDTH_ID = "skill\u200Bmarker";
const FULL_WIDTH_ID = "ａｓｓｅｔ－１";
const RTL_OVERRIDE_NAME = "safe\u202Ename"; // RIGHT-TO-LEFT OVERRIDE

void test("sanitizeMirrorId reduces any unicode to the ASCII-safe alphabet", () => {
  const samples = [
    ARABIC_PATH,
    HEBREW_PATH,
    CJK_PATH,
    EMOJI_PATH,
    COMBINING_NAME,
    ZERO_WIDTH_ID,
    RTL_OVERRIDE_NAME,
    FULL_WIDTH_ID,
  ];

  for (const sample of samples) {
    const sanitized = sanitizeMirrorId(sample);
    assert.match(sanitized, /^[a-zA-Z0-9_-]+$/u, `unsafe id for ${sample}`);
    assert.equal(sanitized, sanitizeMirrorId(sample), "must be deterministic");
  }

  // ASCII ids round-trip untouched.
  assert.equal(sanitizeMirrorId("asset-1_ok"), "asset-1_ok");
  // Mixed ascii + unicode collapses each non-ascii run to a single dash:
  // my- + (ملفات→-) + - + (🚀→-) + -assets => my-----assets.
  assert.equal(
    sanitizeMirrorId(`my-${ARABIC_PATH}-${EMOJI_PATH}`),
    "my-----assets",
  );
});

void test("sanitizeAssetId stays ASCII-safe, deterministic, and distinct for unicode inputs", () => {
  const inputs = [
    ARABIC_PATH,
    HEBREW_PATH,
    CJK_PATH,
    EMOJI_PATH,
    FULL_WIDTH_ID,
    "",
    `-${RTL_OVERRIDE_NAME}-`,
  ];

  const seen = new Set<string>();
  for (const input of inputs) {
    const sanitized = sanitizeAssetId(input);
    assert.match(sanitized, /^[a-zA-Z0-9_-]*[a-f0-9]{12}$/u, `for ${input}`);
    assert.equal(sanitized, sanitizeAssetId(input), "must be deterministic");
    assert.ok(!seen.has(sanitized), `collision for ${input}`);
    seen.add(sanitized);
  }

  // Entirely non-ascii input falls back to the "asset" base with a stable
  // content hash suffix (leading/trailing dashes trimmed), and distinct
  // unicode inputs never collide.
  assert.match(sanitizeAssetId(ARABIC_PATH), /^asset-[a-f0-9]{12}$/u);
  assert.match(sanitizeAssetId(HEBREW_PATH), /^asset-[a-f0-9]{12}$/u);
  assert.notEqual(
    sanitizeAssetId(ARABIC_PATH),
    sanitizeAssetId(HEBREW_PATH),
    "different unicode inputs must not collide",
  );
  // ASCII prefixes survive; only the unicode run is collapsed.
  assert.match(sanitizeAssetId(`my-${ARABIC_PATH}`), /^my-[a-f0-9]{12}$/u);
});

void test("resolveSafeMirrorFilePath treats unicode names as ordinary path data", () => {
  const root = "/repo/root";
  const safeSamples = [
    `${ARABIC_PATH}/file.txt`,
    `${HEBREW_PATH}/${CJK_PATH}/file.txt`,
    `${EMOJI_PATH}/nested/${COMBINING_NAME}.md`,
    `dir${RTL_OVERRIDE_NAME}/file.txt`,
    "normal/..%2Fstill-a-name", // encoded traversal is a literal filename char
  ];

  for (const relativePath of safeSamples) {
    const resolved = resolveSafeMirrorFilePath(root, relativePath);
    assert.ok(
      isPathWithinRoot(root, resolved),
      `unicode path escaped root: ${relativePath}`,
    );
    assert.ok(
      toPosixPath(resolved).endsWith(relativePath),
      `resolved path lost the unicode suffix: ${resolved}`,
    );
  }

  // The refusal contract still holds: no unicode trick makes a dot-segment
  // or absolute path "safe".
  const hostileSamples = [
    "../evil.txt",
    `${ARABIC_PATH}/../../evil.txt`,
    "/etc/passwd",
  ];
  for (const relativePath of hostileSamples) {
    assert.throws(
      () => resolveSafeMirrorFilePath(root, relativePath),
      /Refusing to write mirrored artifact outside raw root/u,
      `traversal not refused: ${relativePath}`,
    );
  }
});

void test("isPathWithinRoot and resolveAllowedAbsolutePath handle unicode roots", () => {
  const root = join("/repo", ARABIC_PATH, HEBREW_PATH);
  const inside = join(root, CJK_PATH, `${EMOJI_PATH}.json`);
  const outside = join("/repo", ARABIC_PATH, "sibling.json");

  assert.ok(isPathWithinRoot(root, inside));
  assert.ok(!isPathWithinRoot(root, outside));
  assert.ok(!isPathWithinRoot(root, join(root, "..", "escape")));

  // resolve() applies the platform drive/separator rules; compare against the
  // canonical resolved form rather than the raw input.
  assert.equal(resolveAllowedAbsolutePath(inside, [root]), resolve(inside));
  assert.equal(resolveAllowedAbsolutePath(outside, [root]), null);
  assert.equal(
    resolveAllowedAbsolutePath(`${ARABIC_PATH}/relative.txt`, [root]),
    null,
    "relative paths are refused",
  );
});

void test("toPosixPath and toRelativePosixPath preserve unicode while normalizing separators", () => {
  const mixed = `${ARABIC_PATH}\\${HEBREW_PATH}\\${CJK_PATH}\\${EMOJI_PATH}.txt`;
  const posix = toPosixPath(mixed);
  assert.equal(
    posix,
    `${ARABIC_PATH}/${HEBREW_PATH}/${CJK_PATH}/${EMOJI_PATH}.txt`,
  );

  const root = `/repo/${ARABIC_PATH}`;
  const file = join(root, HEBREW_PATH, "file.txt");
  assert.equal(toRelativePosixPath(root, file), `${HEBREW_PATH}/file.txt`);
});

void test("lifecycle fingerprints are stable for unicode ids and paths", () => {
  const entry = buildCatalogEntry(
    `${ARABIC_PATH}/${HEBREW_PATH}/${EMOJI_PATH}`,
    {
      duplicateGroup: `${CJK_PATH}-group`,
      install: {
        method: "manual",
        relativePath: `${ARABIC_PATH}/${HEBREW_PATH}/${COMBINING_NAME}`,
      },
    },
  );

  const first = buildAssetLifecycleFingerprint(entry);
  const second = buildAssetLifecycleFingerprint(entry);

  assert.equal(first.lifecycleFingerprint, second.lifecycleFingerprint);
  assert.equal(
    first.sourceCatalogIdentity,
    `source-a|${ARABIC_PATH}/${HEBREW_PATH}/${EMOJI_PATH}|skill|native`,
  );
  assert.ok(
    first.canonicalUpstreamIdentity.endsWith(
      `${ARABIC_PATH}/${HEBREW_PATH}/${COMBINING_NAME}`,
    ),
    "non-URL unicode identity is preserved verbatim",
  );
  assert.equal(first.duplicateGroup, `${CJK_PATH}-group`);
});

void test("lifecycle fingerprints punycode-normalize unicode URL hostnames", () => {
  const entry = buildCatalogEntry("asset-unicode-url");

  const fingerprint = buildAssetLifecycleFingerprint(
    entry,
    buildMirrorEntry("asset-unicode-url", {
      upstream: {
        type: "repo",
        url: "https://مثال.إختبار/acme/Tool/",
      },
    }),
  );

  assert.ok(
    fingerprint.canonicalUpstreamIdentity.startsWith("repo|https://xn--"),
    `expected punycode hostname, got ${fingerprint.canonicalUpstreamIdentity}`,
  );
  assert.ok(
    !/[\u0600-\u06FF]/u.test(fingerprint.canonicalUpstreamIdentity),
    "identity must not retain raw non-ascii hostname bytes",
  );
  assert.equal(
    fingerprint.canonicalUpstreamIdentity,
    buildAssetLifecycleFingerprint(
      entry,
      buildMirrorEntry("asset-unicode-url", {
        upstream: {
          type: "repo",
          url: "HTTPS://مثال.إختبار/acme/Tool/",
        },
      }),
    ).canonicalUpstreamIdentity,
    "protocol/hostname casing is folded for unicode domains too",
  );
});

void test("fingerprint report groups sort unicode duplicate ids deterministically", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-unicode-"));
  try {
    await writeJsonLinesFile(
      join(projectRoot, "discover", "catalog.assets.jsonl"),
      [
        buildCatalogEntry(`${ARABIC_PATH}-a`, {
          duplicateGroup: `${HEBREW_PATH}-g`,
        }),
        buildCatalogEntry(`${ARABIC_PATH}-b`, {
          duplicateGroup: `${HEBREW_PATH}-g`,
        }),
        buildCatalogEntry("plain-c"),
      ],
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), []);

    const report = await buildAssetLifecycleFingerprintReport(projectRoot);
    assert.equal(report.duplicateGroupCount, 1);
    assert.deepEqual(report.duplicateGroups[0]?.groupId, `${HEBREW_PATH}-g`);
    assert.deepEqual(report.duplicateGroups[0]?.assetIds, [
      `${ARABIC_PATH}-a`,
      `${ARABIC_PATH}-b`,
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("real filesystem round-trips work through RTL and CJK directory names", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-unicode-fs-"),
  );
  const nestedDir = join(
    projectRoot,
    ARABIC_PATH,
    HEBREW_PATH,
    CJK_PATH,
    EMOJI_PATH,
  );
  try {
    await mkdir(nestedDir, { recursive: true });

    const payload = {
      id: `${ARABIC_PATH}-1`,
      label: `${HEBREW_PATH} ${EMOJI_PATH}`,
    };
    const jsonPath = join(nestedDir, `${COMBINING_NAME}.json`);
    await writeJsonFile(jsonPath, payload);

    const jsonLinesPath = join(nestedDir, `${ZERO_WIDTH_ID}.jsonl`);
    await writeJsonLinesFile(jsonLinesPath, [
      payload,
      { ...payload, id: "second" },
    ]);

    const readBack = await readTextFileOrNull(jsonPath);
    assert.ok(readBack);
    assert.deepEqual(JSON.parse(readBack), payload);

    const lines = await readJsonLinesFile<typeof payload>(jsonLinesPath);
    assert.equal(lines.length, 2);
    assert.equal(lines[1]?.id, "second");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("resolveAllowedRealFilePath resolves real unicode files inside allowed roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-real-path-"));
  try {
    const unicodeRoot = join(root, HEBREW_PATH);
    await mkdir(unicodeRoot, { recursive: true });
    const targetFile = join(unicodeRoot, `${CJK_PATH}-${COMBINING_NAME}.txt`);
    await writeFile(targetFile, "unicode content", "utf8");

    const resolved = await resolveAllowedRealFilePath(targetFile, [
      unicodeRoot,
    ]);
    assert.ok(resolved, "real unicode file must resolve");
    const realRoot = await realpath(unicodeRoot);
    assert.ok(
      isPathWithinRoot(realRoot, resolved),
      "resolved path must stay inside the real allowed root",
    );

    assert.equal(
      await resolveAllowedRealFilePath(join(unicodeRoot, "missing.txt"), [
        unicodeRoot,
      ]),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function buildCatalogEntry(
  id: string,
  options: {
    duplicateGroup?: string;
    install?: AssetCatalogEntry["install"];
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["opencode", "cursor"],
    compatibilityMode: "native",
    source: {
      sourceId: "source-a",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "https://example.com/acme/tool",
      publisher: "acme",
      publisherVerified: false,
    },
    trust: {
      score: 70,
      signals: ["fixture"],
    },
    capabilities: ["testing"],
    install: options.install ?? {
      method: "manual",
      relativePath: `${id}/README.md`,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: false,
      filePath: `${id}/README.md`,
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 1,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "small",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 0.5,
      hostFit: 0.8,
    },
    dedupe: {
      duplicateGroup: options.duplicateGroup,
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function buildMirrorEntry(
  assetId: string,
  options: {
    upstream?: MirrorIndexEntry["upstream"];
    status?: MirrorIndexEntry["status"];
  } = {},
): MirrorIndexEntry {
  return {
    mirrorId: `sha256-${assetId}`,
    assetId,
    upstream: options.upstream ?? {
      type: "repo",
      url: "https://example.com/acme/tool.git",
      commit: "abc123",
    },
    source: {
      authorityTier: "trusted-community",
      publisher: "acme",
      publisherVerified: false,
    },
    mirroredAt: "2026-01-02T00:00:00.000Z",
    contentHash: "sha256-content-a",
    projectionCandidates: [
      {
        host: "opencode",
        projectionType: "native-skill",
      },
    ],
    status: options.status ?? "approved",
  };
}
