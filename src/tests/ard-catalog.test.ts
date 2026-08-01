/**
 * Tests for ARD catalog export (#325).
 *
 * Covers: URN construction, AssetKind → media type mapping, trust manifest
 * derivation, full catalog export.
 */

import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  ardCatalogInternals,
  buildArdUrn,
  deriveArdTrustManifest,
  mapEntryToArd,
  extractErrorMessage,
  writeArdCatalog,
  type PrettierFormatter,
} from "../ard-catalog.js";

import type { AssetKind, SourceKind } from "../types.js";
import { buildEntry } from "./test-helpers.js";

const { ASSET_KIND_TO_ARD_TYPE, ARD_PUBLISHER_FQDN } = ardCatalogInternals;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

void test("extractErrorMessage returns message from Error instances", () => {
  assert.equal(extractErrorMessage(new Error("test error")), "test error");
  assert.equal(
    extractErrorMessage(new TypeError("type mismatch")),
    "type mismatch",
  );
  assert.equal(extractErrorMessage(new Error("")), "");
});

// ---------------------------------------------------------------------------
// buildArdUrn
// ---------------------------------------------------------------------------

void test("buildArdUrn constructs valid ARD URN", () => {
  const entry = buildEntry({
    id: "my-agent/skill-v1",
    displayName: "My Skill",
    assetKind: "skill",
  });

  const urn = buildArdUrn(entry, "example.com");
  assert.ok(urn.startsWith("urn:ai:example.com:"));
  assert.ok(urn.includes("my-agent-skill-v1"));
});

void test("buildArdUrn replaces slashes and colons", () => {
  const entry = buildEntry({
    id: "org/repo:skill",
    displayName: "Test",
    assetKind: "skill",
  });

  const urn = buildArdUrn(entry, "test.io");
  assert.ok(!urn.includes("/"));
  assert.ok(!urn.includes(":skill")); // colons replaced after the URN prefix
});

void test("buildArdUrn truncates long IDs", () => {
  const entry = buildEntry({
    id: "a".repeat(200),
    displayName: "Test",
    assetKind: "skill",
  });

  const urn = buildArdUrn(entry, "x.io");
  const agentPart = urn.split(":").pop()!;
  assert.ok(agentPart.length <= 64);
});

// ---------------------------------------------------------------------------
// deriveArdTrustManifest
// ---------------------------------------------------------------------------

void test("deriveArdTrustManifest returns undefined for no signals", () => {
  const entry = buildEntry({
    id: "plain-skill",
    displayName: "Plain",
    assetKind: "skill",
  });

  const manifest = deriveArdTrustManifest(entry);
  assert.equal(manifest, undefined);
});

void test("deriveArdTrustManifest maps oms-signed to attestation", () => {
  const entry = buildEntry({
    id: "signed-skill",
    displayName: "Signed Skill",
    assetKind: "skill",
    trust: { score: 60, signals: ["oms-signed"] },
  });

  const manifest = deriveArdTrustManifest(entry)!;
  assert.ok(
    manifest.attestations!.some((a) => a.type === "OMS-Code-Signature"),
  );
});

void test("deriveArdTrustManifest includes domain identity when publisher verified", () => {
  const entry = buildEntry({
    id: "verified-skill",
    displayName: "Verified",
    assetKind: "skill",
    source: {
      sourceId: "v",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 75,
      originUrl: "https://v.example.com",
      publisher: "verified.com",
      publisherVerified: true,
    },
    trust: { score: 70, signals: ["publisher-verified"] },
  });

  const manifest = deriveArdTrustManifest(entry)!;
  assert.equal(manifest.identity, "domain:ar27111994.dev");
  assert.equal(manifest.identityType, "domain");
});

// ---------------------------------------------------------------------------
// buildRepresentativeQueries
// ---------------------------------------------------------------------------

const { buildRepresentativeQueries } = ardCatalogInternals;

void test("buildRepresentativeQueries filters short tokens (length < 2)", () => {
  const entry = buildEntry({
    id: "test-skill",
    displayName: "Test Skill",
    assetKind: "skill",
    capabilities: ["a", "b", "testing", "x", "quality"],
  });

  const queries = buildRepresentativeQueries(entry);

  // "a", "b", "x" should be filtered; "testing", "quality" should appear
  assert.ok(queries.some((q) => q.includes("testing")));
  assert.ok(queries.some((q) => q.includes("quality")));
  assert.ok(!queries.some((q) => q.includes('"a"')));
  assert.ok(!queries.some((q) => q.includes('"b"')));
  assert.ok(!queries.some((q) => q.includes('"x"')));
});

void test("buildRepresentativeQueries filters numeric-only tokens", () => {
  const entry = buildEntry({
    id: "test-skill",
    displayName: "Test Skill",
    assetKind: "skill",
    capabilities: ["123", "42", "testing", "007"],
  });

  const queries = buildRepresentativeQueries(entry);

  // Numeric-only tokens should be filtered
  assert.ok(queries.some((q) => q.includes("testing")));
  assert.ok(!queries.some((q) => q.includes("123")));
  assert.ok(!queries.some((q) => q.includes("42")));
  assert.ok(!queries.some((q) => q.includes("007")));
});

void test("buildRepresentativeQueries filters stopwords", () => {
  const entry = buildEntry({
    id: "test-skill",
    displayName: "Test Skill",
    assetKind: "skill",
    capabilities: ["the", "is", "for", "testing", "and"],
  });

  const queries = buildRepresentativeQueries(entry);

  // Stopwords should be filtered; "testing" should appear
  assert.ok(queries.some((q) => q.includes("testing")));
  assert.ok(!queries.some((q) => q.includes('"the"')));
  assert.ok(!queries.some((q) => q.includes('"is"')));
  assert.ok(!queries.some((q) => q.includes('"for"')));
  assert.ok(!queries.some((q) => q.includes('"and"')));
});

void test("buildRepresentativeQueries includes valid capabilities in queries", () => {
  const entry = buildEntry({
    id: "test-skill",
    displayName: "Test Skill",
    assetKind: "skill",
    capabilities: ["testing", "debugging", "linting"],
  });

  const queries = buildRepresentativeQueries(entry);

  assert.ok(queries.some((q) => q.includes("testing")));
  assert.ok(queries.some((q) => q.includes("debugging")));
  assert.ok(queries.some((q) => q.includes("linting")));
});

void test("buildRepresentativeQueries handles mixed valid and invalid tokens", () => {
  const entry = buildEntry({
    id: "test-skill",
    displayName: "Test Skill",
    assetKind: "skill",
    capabilities: ["a", "testing", "42", "the", "debugging", "", "x"],
  });

  const queries = buildRepresentativeQueries(entry);

  // Valid capabilities should appear
  assert.ok(queries.some((q) => q.includes("testing")));
  assert.ok(queries.some((q) => q.includes("debugging")));
  // Empty string, single-char, numeric, and stopwords should all be filtered
  assert.ok(!queries.some((q) => q.includes('"a"')));
  assert.ok(!queries.some((q) => q.includes('"42"')));
  assert.ok(!queries.some((q) => q.includes('"the"')));
  assert.ok(!queries.some((q) => q.includes('"x"')));
});

// ---------------------------------------------------------------------------
// mapEntryToArd
// ---------------------------------------------------------------------------

void test("mapEntryToArd maps all required fields", () => {
  const entry = buildEntry({
    id: "test-skill",
    displayName: "Test Skill",
    assetKind: "skill",
    capabilities: ["testing", "quality"],
    hosts: ["claude-code"],
    source: {
      sourceId: "test-src",
      authorityTier: "unverified-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "https://test.example.com",
      publisher: "TestPub",
      publisherVerified: false,
    },
    install: {
      method: "repo-reference",
      manifestEntry: "https://test.example.com/skill.md",
    },
  });

  const ard = mapEntryToArd(entry, "test.io", "2.0.0");

  assert.equal(ard.version, "2.0.0");
  assert.ok(ard.identifier.startsWith("urn:ai:test.io:"));
  assert.equal(ard.type, "application/ai-skill");
  assert.ok(ard.capabilities.length <= 20);
  assert.ok(ard.representativeQueries.length > 0);
  assert.ok(ard.tags.length > 0);
});

void test("mapEntryToArd maps mcp-server to correct ARD type", () => {
  const entry = buildEntry({
    id: "mcp-tool",
    displayName: "MCP Tool",
    assetKind: "mcp-server",
  });

  const ard = mapEntryToArd(entry, "test.io", "1.0.0");
  assert.equal(ard.type, "application/mcp-server+json");
});

void test("mapEntryToArd includes trust manifest when signals present", () => {
  const entry = buildEntry({
    id: "trusted-skill",
    displayName: "Trusted",
    assetKind: "skill",
    trust: { score: 75, signals: ["oms-signed", "oms-trust-anchor"] },
  });

  const ard = mapEntryToArd(entry, "test.io", "1.0.0");
  assert.ok(ard.trustManifest != null);
  assert.ok(ard.trustManifest!.attestations!.length >= 2);
});

void test("mapEntryToArd uses originUrl over manifestEntry for url field (#368)", () => {
  const entry = buildEntry({
    id: "url-test-skill",
    displayName: "URL Test",
    assetKind: "skill",
    source: {
      sourceId: "url-src",
      authorityTier: "unverified-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "https://github.com/test/skills/blob/main/SKILL.md",
      publisher: "TestPub",
      publisherVerified: false,
    },
    install: {
      method: "repo-reference",
      // manifestEntry is typically a git hash, NOT a URL
      manifestEntry: "a94df09f75fba2f11c63103c3e573c729226a6e0",
    },
  });

  const ard = mapEntryToArd(entry, "test.io", "2.0.0");
  // The url must be the resolvable originUrl, not the git hash
  assert.equal(ard.url, "https://github.com/test/skills/blob/main/SKILL.md");
  // It must be an https:// URL, not a hash
  assert.ok(
    ard.url.startsWith("https://"),
    "url must be a resolvable https URL",
  );
});

void test("mapEntryToArd produces HTTP urls for all harvestable source kinds (#380)", () => {
  // Each source kind that can be harvested should produce a resolvable URL.
  const sourceKinds: Array<{
    kind: SourceKind;
    originUrl: string;
    manifestEntry: string;
  }> = [
    {
      kind: "repo",
      originUrl: "https://github.com/user/repo/blob/main/SKILL.md",
      manifestEntry: "a94df09f75fba2f11c63103c3e573c729226a6e0",
    },
    {
      kind: "package-registry",
      originUrl: "https://www.npmjs.com/package/example-pkg",
      manifestEntry: "example-pkg",
    },
    {
      kind: "registry",
      originUrl:
        "https://raw.githubusercontent.com/official-skills/main/SKILL.md",
      manifestEntry: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
    },
    {
      kind: "local-directory",
      originUrl: "file:///home/user/projects/local-skill.md",
      manifestEntry: "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
    },
    {
      kind: "ard-registry",
      originUrl: "https://publisher.example.com/.well-known/ai-catalog.json",
      manifestEntry: "f1e2d3c4b5a6f7e8d9c0b1a2",
    },
    {
      kind: "docs",
      originUrl: "https://docs.cursor.com/agent-skills",
      manifestEntry: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    },
    {
      kind: "marketplace",
      originUrl:
        "https://marketplace.visualstudio.com/items?itemName=ms-python.python",
      manifestEntry: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1",
    },
    {
      kind: "local-manifest",
      originUrl: "file:///home/user/.local/share/agent-harness/manifest.json",
      manifestEntry: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
    },
  ];

  for (const { kind, originUrl, manifestEntry } of sourceKinds) {
    const entry = buildEntry({
      id: `test-${kind}`,
      displayName: `Test ${kind}`,
      assetKind: "skill",
      source: {
        sourceId: `src-${kind}`,
        authorityTier: "unverified-community",
        sourceKind: kind,
        sourcePriority: 70,
        originUrl,
        publisher: "TestPub",
        publisherVerified: false,
      },
      install: {
        method: "repo-reference",
        manifestEntry,
      },
    });

    const ard = mapEntryToArd(entry, "test.io", "2.0.0");
    // For non-local kinds, the URL must be the originUrl (an HTTP URL).
    if (kind !== "local-directory" && kind !== "local-manifest") {
      assert.equal(
        ard.url,
        originUrl,
        `${kind}: url must be the originUrl, not the manifestEntry hash`,
      );
      assert.ok(
        ard.url!.startsWith("http"),
        `${kind}: url must be a resolvable HTTP(S) URL, got ${ard.url?.slice(0, 50)}`,
      );
    } else {
      // file:// URLs are acceptable for local directories and manifests.
      assert.ok(
        ard.url!.startsWith("file://"),
        `${kind}: local directory url must be a file:// URL`,
      );
    }
  }
});

void test("mapEntryToArd preserves empty originUrl (does not fall back to manifestEntry for empty string)", () => {
  const entry = buildEntry({
    id: "empty-origin",
    displayName: "Empty Origin",
    assetKind: "skill",
    source: {
      sourceId: "empty-src",
      authorityTier: "unverified-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "",
      publisher: "TestPub",
      publisherVerified: false,
    },
    install: {
      method: "repo-reference",
      manifestEntry: "abc123def456",
    },
  });

  const ard = mapEntryToArd(entry, "test.io", "2.0.0");
  // ?? only falls back for null/undefined, not empty string.
  // An empty-string originUrl is a data-quality issue that should be
  // caught by the harvest pipeline, not silently papered over.
  assert.equal(ard.url, "");
});

// ---------------------------------------------------------------------------
// ASSET_KIND_TO_ARD_TYPE — coverage
// ---------------------------------------------------------------------------

void test("ASSET_KIND_TO_ARD_TYPE covers all AssetKind values", () => {
  const kinds: AssetKind[] = [
    "mcp-server",
    "agent",
    "skill",
    "plugin",
    "extension",
    "reference-pack",
    "instruction",
    "workflow",
    "hook",
    "prompt-pack",
    "payable-api",
    "acp-agent",
  ];

  for (const kind of kinds) {
    const ardType = ASSET_KIND_TO_ARD_TYPE[kind];
    assert.ok(typeof ardType === "string", `missing ARD type for ${kind}`);
  }
});

// ---------------------------------------------------------------------------
// writeArdCatalog — integration
// ---------------------------------------------------------------------------

void test("writeArdCatalog writes valid ARD catalog to .well-known/", async () => {
  const root = join(tmpdir(), `agent-harness-ard-test-${randomUUID()}`);

  try {
    // Create minimal selected catalog
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    const entry = buildEntry({
      id: "export-test-skill",
      displayName: "Export Test",
      assetKind: "skill",
      capabilities: ["export"],
    });

    // JSONL format
    await writeFile(
      join(discoverDir, "catalog.selected.jsonl"),
      JSON.stringify(entry) + "\n",
      "utf8",
    );

    const result = await writeArdCatalog(root, "2.0.0");

    assert.ok(result.entryCount > 0, "should export at least one entry");
    const normalizedPath = result.filePath.replace(/\\/g, "/");
    assert.ok(
      normalizedPath.endsWith(".well-known/ai-catalog.json"),
      "should write to .well-known/",
    );

    // Validate the written JSON
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(result.filePath, "utf8");
    const catalog = JSON.parse(raw) as Record<string, unknown>;

    assert.equal(
      catalog["$schema"],
      "https://agenticresourcediscovery.org/spec/v0.9/schemas/ai-catalog.json",
    );
    assert.equal(catalog["publisher"], ARD_PUBLISHER_FQDN);
    assert.equal(catalog["version"], "2.0.0");
    const entries = catalog["entries"] as
      Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(entries));
    assert.ok((entries as Array<Record<string, unknown>>).length > 0);
    assert.equal(
      (entries as Array<Record<string, unknown>>)[0]["displayName"],
      "Export Test",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeArdCatalog handles empty catalog gracefully", async () => {
  const root = join(tmpdir(), `agent-harness-ard-empty-${randomUUID()}`);

  try {
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    // Empty JSONL
    await writeFile(join(discoverDir, "catalog.selected.jsonl"), "", "utf8");

    const result = await writeArdCatalog(root, "2.0.0");
    assert.equal(result.entryCount, 0);
    const normalizedPath = result.filePath.replace(/\\/g, "/");
    assert.ok(normalizedPath.endsWith(".well-known/ai-catalog.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeArdCatalog skips malformed entries without crashing", async () => {
  const root = join(tmpdir(), `agent-harness-ard-malformed-${randomUUID()}`);

  try {
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    // Corrupt entry — missing 'source' will cause mapEntryToArd to throw.
    const corruptEntry = JSON.stringify({
      id: "bad-entry",
      displayName: "Bad",
      assetKind: "skill",
    });
    const validEntry = JSON.stringify({
      id: "good-entry",
      displayName: "Good",
      assetKind: "skill",
      hosts: ["claude-code"],
      compatibilityMode: "adaptable",
      source: {
        sourceId: "test",
        authorityTier: "unverified-community",
        sourceKind: "repo",
        sourcePriority: 70,
        originUrl: "https://example.com",
        publisher: "test",
        publisherVerified: false,
      },
      trust: { score: 50, signals: [] },
      capabilities: ["test"],
      install: { method: "test", manifestEntry: "https://example.com" },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        lineCount: 1,
        rootPath: "https://example.com",
      },
      maintenance: {
        lastUpdated: "2026-01-01T00:00:00Z",
        stars: 0,
        releaseCadence: "occasional",
      },
      risk: { hooks: false, execScripts: false, requiresNetwork: false },
      contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
      fit: { portfolioFit: 0.5, hostFit: 0.5 },
      dedupe: { duplicateGroup: null, candidateRankHint: 0 },
      status: "fresh",
    });

    await writeFile(
      join(discoverDir, "catalog.selected.jsonl"),
      corruptEntry + "\n" + validEntry + "\n",
      "utf8",
    );

    const result = await writeArdCatalog(root, "2.0.0");
    assert.equal(result.entryCount, 1, "corrupt entry skipped, valid exported");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CI conformance validation (#325 — acceptance criteria)
// ---------------------------------------------------------------------------

void test("committed .well-known/ai-catalog.json conforms to ARD v0.9 schema", async () => {
  const { readFile } = await import("node:fs/promises");
  const catalogPath = join(process.cwd(), ".well-known", "ai-catalog.json");
  const raw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Record<string, unknown>;

  // §2 — top-level required fields
  assert.equal(
    catalog["$schema"],
    "https://agenticresourcediscovery.org/spec/v0.9/schemas/ai-catalog.json",
    "must reference the ARD v0.9 schema URI",
  );
  assert.equal(typeof catalog["publisher"], "string", "publisher is required");
  assert.equal(typeof catalog["version"], "string", "version is required");
  assert.ok(Array.isArray(catalog["entries"]), "entries must be an array");

  // Publisher must be a verifiable FQDN (§4.2.1)
  assert.ok(
    (catalog["publisher"] as string).includes("."),
    "publisher must be a valid FQDN",
  );

  // Each entry must have required fields (§3.3)
  const entries = catalog["entries"] as Array<Record<string, unknown>>;
  for (const entry of entries) {
    assert.equal(
      typeof entry["identifier"],
      "string",
      "entry.identifier is required",
    );
    assert.ok(
      (entry["identifier"] as string).startsWith("urn:ai:"),
      "entry.identifier must be a valid URN",
    );
    assert.equal(
      typeof entry["displayName"],
      "string",
      "entry.displayName is required",
    );
    assert.equal(typeof entry["type"], "string", "entry.type is required");
    assert.ok(
      Array.isArray(entry["capabilities"]),
      "entry.capabilities must be an array",
    );
  }

  // Release gate: if generatedAt is populated (regenerated catalog), entries
  // must be non-empty. An empty generatedAt signals the development skeleton
  // which is valid in CI but must be regenerated before publishing.
  if (typeof catalog["generatedAt"] === "string" && catalog["generatedAt"]) {
    assert.ok(
      entries.length > 0,
      "release gate: generatedAt is populated but entries is empty — regenerate via 'discover ard-export' before publishing",
    );
  }
});

void test("writeArdCatalog empty catalog has valid generatedAt ISO-8601 timestamp (#342)", async () => {
  const root = join(tmpdir(), `agent-harness-ard-empty-ts-${randomUUID()}`);

  try {
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    // Write an empty catalog file — no entries.
    await writeFile(join(discoverDir, "catalog.selected.jsonl"), "", "utf8");

    const result = await writeArdCatalog(root, "2.0.0");
    assert.equal(result.entryCount, 0);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(result.filePath, "utf8");
    const catalog = JSON.parse(raw) as Record<string, unknown>;

    // generatedAt must be a valid ISO-8601 timestamp even for empty catalogs.
    const generatedAt = catalog["generatedAt"] as string;
    assert.equal(typeof generatedAt, "string");
    assert.ok(generatedAt.length > 0, "generatedAt must not be empty");
    const parsed = new Date(generatedAt);
    assert.ok(
      !Number.isNaN(parsed.getTime()),
      `generatedAt must be a valid ISO-8601 timestamp, got "${generatedAt}"`,
    );
    assert.ok(
      parsed.toISOString() === generatedAt,
      `generatedAt must be in ISO-8601 format, got "${generatedAt}"`,
    );
    assert.equal(catalog["version"], "2.0.0");
    assert.ok(Array.isArray(catalog["entries"]));
    assert.equal((catalog["entries"] as Array<unknown>).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeArdCatalog malformed entry error includes asset ID and cause (#343)", async () => {
  const root = join(tmpdir(), `agent-harness-ard-err-${randomUUID()}`);

  try {
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    // Build a valid entry alongside a corrupt line.
    const validEntry = buildEntry({
      id: "valid-test",
      displayName: "Valid",
      assetKind: "skill",
    });
    const corrupt = '{"id":null,"displayName":"CorruptAsset"}';

    await writeFile(
      join(discoverDir, "catalog.selected.jsonl"),
      corrupt + "\n" + JSON.stringify(validEntry) + "\n",
      "utf8",
    );

    // Capture console.warn output.
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };

    try {
      const result = await writeArdCatalog(root, "2.0.0");
      assert.equal(result.entryCount, 1, "valid entry still exported");
    } finally {
      console.warn = origWarn;
    }

    assert.ok(warnings.length >= 1, "expected at least one warning");
    const warning = warnings.join("\n");
    // Warning must identify the malformed entry with its displayName
    // (falls back from id → displayName → "(unknown)").
    assert.ok(
      warning.includes("ard-catalog: skipping malformed entry"),
      `warning must identify the malformed entry, got: "${warning}"`,
    );
    // The fixture has id:null, displayName:"CorruptAsset" → falls back to displayName.
    assert.ok(
      warning.includes("CorruptAsset"),
      `warning must report malformed entry identity as "CorruptAsset", got: "${warning}"`,
    );
    // Ensure a non-empty cause is present after the identity.
    const causeIndex = warning.indexOf("CorruptAsset): ");
    assert.ok(
      causeIndex !== -1,
      `warning must include "CorruptAsset): " prefix before cause, got: "${warning}"`,
    );
    const afterPrefix = warning.slice(causeIndex + "CorruptAsset): ".length);
    assert.ok(
      afterPrefix.length > 0,
      `warning must include a non-empty cause after the identity, got: "${warning}"`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeArdCatalog falls back to (unknown) when both id and displayName are missing", async () => {
  const root = join(tmpdir(), `agent-harness-ard-noidentity-${randomUUID()}`);

  try {
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    // Build a valid entry alongside a completely anonymous corrupt line.
    const validEntry = buildEntry({
      id: "valid-entry",
      displayName: "Valid",
      assetKind: "skill",
    });
    const corrupt = "{}";

    await writeFile(
      join(discoverDir, "catalog.selected.jsonl"),
      corrupt + "\n" + JSON.stringify(validEntry) + "\n",
      "utf8",
    );

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };

    try {
      const result = await writeArdCatalog(root, "2.0.0");
      assert.equal(result.entryCount, 1, "valid entry still exported");
    } finally {
      console.warn = origWarn;
    }

    assert.ok(warnings.length >= 1, "expected at least one warning");
    const warning = warnings.join("\n");
    assert.ok(
      warning.includes("(unknown)"),
      `warning must fall back to "(unknown)" when no id or displayName, got: "${warning}"`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeArdCatalog falls back to 0.0.0 version when no package.json", async () => {
  const root = join(tmpdir(), `agent-harness-ard-nopkg-${randomUUID()}`);

  try {
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    const entry = buildEntry({
      id: "no-pkg-entry",
      displayName: "No Package",
      assetKind: "skill",
    });
    await writeFile(
      join(discoverDir, "catalog.selected.jsonl"),
      JSON.stringify(entry) + "\n",
      "utf8",
    );

    // No package.json — version resolution falls back to "0.0.0"
    const result = await writeArdCatalog(root);

    assert.equal(result.entryCount, 1);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(result.filePath, "utf8");
    const catalog = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(catalog["version"], "0.0.0", "falls back to 0.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeArdCatalog resolves version from package.json when present", async () => {
  const root = join(tmpdir(), `agent-harness-ard-pkgver-${randomUUID()}`);

  try {
    const discoverDir = join(root, "discover", "output");
    await mkdir(discoverDir, { recursive: true });

    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ version: "3.0.0-test" }),
      "utf8",
    );

    const entry = buildEntry({
      id: "ver-test",
      displayName: "Version Test",
      assetKind: "skill",
    });
    await writeFile(
      join(discoverDir, "catalog.selected.jsonl"),
      JSON.stringify(entry) + "\n",
      "utf8",
    );

    const result = await writeArdCatalog(root);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(result.filePath, "utf8");
    const catalog = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(catalog["version"], "3.0.0-test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── #348: Prettier-unavailable coverage ─────────────────────────────────

void test("writeArdCatalog gracefully handles Prettier import failure (#348)", async () => {
  const root = join(tmpdir(), `agent-harness-test-${randomUUID()}`);
  const catalogPath = join(
    root,
    "discover",
    "output",
    "catalog.selected.jsonl",
  );
  const pkgPath = join(root, "package.json");

  await mkdir(catalogPath.replace("catalog.selected.jsonl", ""), {
    recursive: true,
  });
  // Write a minimal valid catalog entry as JSONL.
  const minimalEntry = {
    id: "test-skill",
    displayName: "Test Skill",
    assetKind: "skill",
    hosts: ["shared"],
    compatibilityMode: "native",
    source: {
      sourceId: "test-source",
      sourceKind: "repo",
      registryKind: undefined,
      publisherName: "Test",
      category: "tools",
      authorityTier: "trusted-community",
      sourcePriority: 70,
      originUrl: "https://example.com",
      publisher: "Test",
      publisherVerified: false,
    },
    trust: { score: 80, signals: ["test"], breakdown: {} },
    capabilities: ["testing"],
    install: { installMethod: "manual" },
    evidence: {
      classification: { source: "test", strength: "strong", detail: "test" },
    },
    maintenance: { lastUpdated: new Date().toISOString() },
    dedupe: {},
    score: 80,
    demand: 30,
    authority: 30,
    popularity: 20,
    freshness: 0,
    security: 0,
    compatibility: 0,
    tokens: [],
    ecosystems: [],
    tags: [],
    platforms: [],
    languageSupport: [],
    description: "",
    descriptionTokens: [],
    harvestTimestamp: 0,
    kind: "skill",
  };
  await writeFile(catalogPath, `${JSON.stringify(minimalEntry)}\n`, "utf8");
  await writeFile(pkgPath, JSON.stringify({ version: "2.0.0" }), "utf8");

  // Inject a failing prettier formatter to exercise the catch block.
  const failingImport: PrettierFormatter = async () => {
    throw new Error("prettier module not installed");
  };

  try {
    const result = await writeArdCatalog(root, "2.0.0", failingImport);

    assert.ok(result.filePath, "output path should be returned");
    assert.equal(result.entryCount, 1, "entry count should be 1");

    // Read back to confirm valid JSON was written even without Prettier.
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(result.filePath, "utf8");
    const catalog = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(catalog["version"], "2.0.0");
    assert.equal((catalog["entries"] as Array<unknown>).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
