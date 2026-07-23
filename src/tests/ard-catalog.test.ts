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
  writeArdCatalog,
} from "../ard-catalog.js";

import type { AssetCatalogEntry, AssetKind } from "../types.js";

const { ASSET_KIND_TO_ARD_TYPE, ARD_PUBLISHER_FQDN } = ardCatalogInternals;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PartialEntry = Partial<AssetCatalogEntry> & {
  id: string;
  displayName: string;
  assetKind: AssetKind;
};

function buildEntry(overrides: PartialEntry): AssetCatalogEntry {
  return {
    id: overrides.id,
    displayName: overrides.displayName,
    assetKind: overrides.assetKind,
    hosts: overrides.hosts ?? ["claude-code"],
    compatibilityMode: overrides.compatibilityMode ?? "adaptable",
    source: {
      sourceId: overrides.source?.sourceId ?? "test-source",
      authorityTier: overrides.source?.authorityTier ?? "unverified-community",
      sourceKind: overrides.source?.sourceKind ?? "repo",
      sourcePriority: overrides.source?.sourcePriority ?? 70,
      originUrl: overrides.source?.originUrl ?? "https://example.com/test",
      publisher: overrides.source?.publisher ?? "test-publisher",
      publisherVerified: overrides.source?.publisherVerified ?? false,
    },
    trust: {
      score: overrides.trust?.score ?? 50,
      signals: overrides.trust?.signals ?? [],
    },
    capabilities: overrides.capabilities ?? ["test"],
    install: {
      method: overrides.install?.method ?? "repo-reference",
      manifestEntry:
        overrides.install?.manifestEntry ??
        "https://example.com/test/manifest.json",
    },
    evidence: {
      manifestFound: overrides.evidence?.manifestFound ?? true,
      readmeFound: overrides.evidence?.readmeFound ?? true,
      examplesFound: overrides.evidence?.examplesFound ?? false,
      docsLinked: overrides.evidence?.docsLinked ?? true,
      lineCount: overrides.evidence?.lineCount ?? 10,
      rootPath: overrides.evidence?.rootPath ?? "https://example.com/test",
      classification: overrides.evidence?.classification ?? null,
    },
    maintenance: {
      lastUpdated: overrides.maintenance?.lastUpdated ?? "2026-01-01T00:00:00Z",
      stars: overrides.maintenance?.stars ?? 0,
      releaseCadence: overrides.maintenance?.releaseCadence ?? "occasional",
    },
    risk: overrides.risk ?? {
      hooks: false,
      execScripts: false,
      requiresNetwork: false,
    },
    contextCost: overrides.contextCost ?? {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: overrides.fit ?? { portfolioFit: 0.5, hostFit: 0.5 },
    dedupe: overrides.dedupe ?? {
      duplicateGroup: null,
      candidateRankHint: 0,
    },
    status: overrides.status ?? "fresh",
  } as AssetCatalogEntry;
}

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
  assert.equal(manifest.identity, "domain:verified.com");
  assert.equal(manifest.identityType, "domain");
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
    const discoverDir = join(root, ".agent-harness", "discover", "output");
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
      | Array<Record<string, unknown>>
      | undefined;
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
    const discoverDir = join(root, ".agent-harness", "discover", "output");
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
    const discoverDir = join(root, ".agent-harness", "discover", "output");
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
});

void test("writeArdCatalog falls back to 0.0.0 version when no package.json", async () => {
  const root = join(tmpdir(), `agent-harness-ard-nopkg-${randomUUID()}`);

  try {
    const discoverDir = join(root, ".agent-harness", "discover", "output");
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
