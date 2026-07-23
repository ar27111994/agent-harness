/**
 * ARD (Agentic Resource Discovery) catalog export.
 *
 * Maps the agent-harness asset catalog to the ARD v0.9 `ai-catalog.json` format
 * and writes it to `.well-known/ai-catalog.json` so ARD-compliant registries
 * (GitHub Agent Finder, HuggingFace Discover, Google Agent Registry) can
 * discover and index agent-harness assets.
 *
 * Spec: https://agenticresourcediscovery.org/spec
 * Tickets: #325, #327, #328, #329
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AssetCatalogEntry, AssetKind } from "./types.js";

// ---------------------------------------------------------------------------
// ARD Schema Types (§3)
// ---------------------------------------------------------------------------

/** ARD compliance attestation (§3.5). */
export interface ArdAttestation {
  type: string;
  uri?: string;
  description?: string;
}

/** ARD trust manifest (§3.5). */
export interface ArdTrustManifest {
  identity?: string;
  identityType?: "spiffe" | "did" | "x509" | "domain" | "oauth";
  attestations?: ArdAttestation[];
  signature?: string;
}

/** Single ARD catalog entry (§3.3). */
export interface ArdCatalogEntry {
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: Record<string, unknown>;
  description?: string;
  capabilities: string[];
  representativeQueries: string[];
  version: string;
  updatedAt: string;
  tags: string[];
  trustManifest?: ArdTrustManifest;
}

/** Top-level ARD catalog object. */
export interface ArdCatalog {
  $schema: string;
  publisher: string;
  version: string;
  generatedAt: string;
  entries: ArdCatalogEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ARD spec schema URI. */
const ARD_SCHEMA =
  "https://agenticresourcediscovery.org/spec/v0.9/schemas/ai-catalog.json";

/** Publisher FQDN for agent-harness. */
const PUBLISHER_FQDN = "ar27111994.github.io";

/** ARD type mapping: AssetKind → ARD media type. */
const ASSET_KIND_TO_ARD_TYPE: Record<AssetKind, string> = {
  "mcp-server": "application/mcp-server+json",
  agent: "application/a2a-agent-card+json",
  skill: "application/ai-skill",
  plugin: "application/ai-skill+json",
  "acp-agent": "application/a2a-agent-card+json",
  extension: "application/openapi+json",
  "reference-pack": "application/ai-catalog+json",
  instruction: "application/ai-skill+md",
  workflow: "application/ai-skill+md",
  hook: "application/ai-skill+json",
  "prompt-pack": "application/ai-skill+md",
  "payable-api": "application/openapi+json",
};

/** ARD trust attestations derived from agent-harness trust signals. */
const TRUST_SIGNAL_TO_ATTESTATION: Record<string, ArdAttestation> = {
  "oms-signed": {
    type: "OMS-Code-Signature",
    description: "Asset is OMS-signed via skill.oms.sig",
  },
  "oms-trust-anchor": {
    type: "OMS-Trust-Anchor",
    description: "Repository contains nv-agent-root-cert.pem trust anchor",
  },
  "publisher-verified": {
    type: "Publisher-Verified",
    description: "Publisher identity verified by the source registry",
  },
};

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Builds an ARD URN identifier from source and asset metadata.
 *
 * Format: urn:ai:<publisher-fqdn>:<namespace>:<agent-name>
 * Per ARD §4.2.1 — domain is the trust anchor.
 */
export function buildArdUrn(
  entry: AssetCatalogEntry,
  publisherFqdn: string,
): string {
  const namespace = entry.source.sourceKind;
  const agentName = entry.id.replace(/[/:@]/g, "-").slice(0, 64);
  return `urn:ai:${publisherFqdn}:${namespace}:${agentName}`;
}

/**
 * Derives ARD trust manifest signals from agent-harness trust data.
 */
export function deriveArdTrustManifest(
  entry: AssetCatalogEntry,
): ArdTrustManifest | undefined {
  const attestations: ArdAttestation[] = [];

  for (const signal of entry.trust.signals) {
    const attestation = TRUST_SIGNAL_TO_ATTESTATION[signal];
    if (attestation) {
      attestations.push(attestation);
    }
  }

  const identity =
    entry.source.publisherVerified && entry.source.publisher
      ? `domain:${entry.source.publisher}`
      : undefined;

  if (!identity && attestations.length === 0) return undefined;

  return {
    identity,
    identityType: identity ? "domain" : undefined,
    attestations: attestations.length > 0 ? attestations : undefined,
  };
}

/**
 * Maps a single agent-harness AssetCatalogEntry to an ARD catalog entry.
 */
export function mapEntryToArd(
  entry: AssetCatalogEntry,
  publisherFqdn: string,
  version: string,
): ArdCatalogEntry {
  const ardType =
    ASSET_KIND_TO_ARD_TYPE[entry.assetKind] ?? "application/ai-skill";

  return {
    identifier: buildArdUrn(entry, publisherFqdn),
    displayName: entry.displayName,
    type: ardType,
    url: entry.install.manifestEntry ?? entry.source.originUrl,
    description: entry.evidence.classification
      ? `${entry.assetKind} asset from ${entry.source.sourceId} (${entry.source.sourceKind})`
      : `Agent asset from ${entry.source.sourceId}`,
    capabilities: entry.capabilities.slice(0, 20),
    representativeQueries: buildRepresentativeQueries(entry).slice(0, 10),
    version,
    updatedAt: entry.maintenance.lastUpdated,
    tags: [
      entry.assetKind,
      entry.source.sourceKind,
      entry.compatibilityMode,
      ...entry.hosts.slice(0, 5),
      entry.source.authorityTier,
    ],
    trustManifest: deriveArdTrustManifest(entry),
  };
}

/**
 * Builds synthetic representative queries from capabilities.
 */
function buildRepresentativeQueries(entry: AssetCatalogEntry): string[] {
  const queries: string[] = [];
  const display = entry.displayName.toLowerCase();

  queries.push(
    `What ${entry.assetKind} assets are available from ${entry.source.sourceId}?`,
  );
  queries.push(`Find ${display} for ${entry.hosts[0] ?? "agent"} workflows`);

  for (const cap of entry.capabilities.slice(0, 5)) {
    queries.push(`Install a ${entry.assetKind} for ${cap}`);
  }

  return queries;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Exports the agent-harness catalog to ARD `ai-catalog.json` format.
 *
 * Reads `discover/output/catalog.selected.jsonl` (the selected catalog) and
 * writes `.well-known/ai-catalog.json` so ARD-compliant registries can discover
 * agent-harness as a publisher.
 *
 * @param projectRoot - Agent-harness project root.
 * @param version - Package version to stamp on the ARD catalog.
 * @returns Path to the written file and entry count.
 */
export async function writeArdCatalog(
  projectRoot: string,
  version?: string,
): Promise<{ filePath: string; entryCount: number }> {
  // Use dynamic import for ESM compatibility at runtime
  const { readJsonLinesFile } = await import("./files.js");

  const catalogPath = join(
    projectRoot,
    ".agent-harness",
    "discover",
    "output",
    "catalog.selected.jsonl",
  );
  const wellKnownDir = join(projectRoot, ".well-known");

  const entries = await readJsonLinesFile<AssetCatalogEntry>(catalogPath);
  const pkgVersion =
    version ??
    (await (async () => {
      try {
        const { readFile: rf } = await import("node:fs/promises");
        const pkgRaw = await rf(join(projectRoot, "package.json"), "utf8");
        const pkg = JSON.parse(pkgRaw) as { version?: string };
        return pkg.version ?? "0.0.0";
      } catch {
        return "0.0.0";
      }
    })());

  const ardEntries: ArdCatalogEntry[] = [];
  for (const entry of entries) {
    try {
      ardEntries.push(mapEntryToArd(entry, PUBLISHER_FQDN, pkgVersion));
    } catch {
      // Skip entries that fail mapping (malformed data).
    }
  }

  const catalog: ArdCatalog = {
    $schema: ARD_SCHEMA,
    publisher: PUBLISHER_FQDN,
    version: pkgVersion,
    generatedAt: new Date().toISOString(),
    entries: ardEntries,
  };

  await mkdir(wellKnownDir, { recursive: true });
  const filePath = join(wellKnownDir, "ai-catalog.json");
  // Atomic write: write to temp file first, then rename. Prevents
  // a crash from leaving a partial ai-catalog.json on disk.
  const tempPath = `${filePath}.tmp-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tempPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  await rename(tempPath, filePath);

  return { filePath, entryCount: ardEntries.length };
}

/**
 * Provide internals for unit testing.
 */
export const ardCatalogInternals = {
  buildArdUrn,
  deriveArdTrustManifest,
  mapEntryToArd,
  ASSET_KIND_TO_ARD_TYPE,
  TRUST_SIGNAL_TO_ATTESTATION,
  PUBLISHER_FQDN,
};
