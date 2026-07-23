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

import type { AssetCatalogEntry } from "./types.js";

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

import {
  ARD_PUBLISHER_FQDN,
  ARD_SCHEMA_URI,
  ASSET_KIND_TO_ARD_TYPE,
  TRUST_SIGNAL_TO_ATTESTATION,
  getArdPublisherFqdn,
} from "./ard/types.js";

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
    // identityType is always "domain" when identity is set; undefined arm is
    // defensive for types that don't match the current publisher model.
    /* c8 ignore next 2 */
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
    // All AssetKind values are mapped; fallback guards future kinds.
    /* c8 ignore next */
    ASSET_KIND_TO_ARD_TYPE[entry.assetKind] ?? "application/ai-skill";

  return {
    identifier: buildArdUrn(entry, publisherFqdn),
    displayName: entry.displayName,
    type: ardType,
    // manifestEntry is always set by harvesters; fallback is defensive.
    /* c8 ignore next */
    url: entry.install.manifestEntry ?? entry.source.originUrl,
    // classification is set by all harvesters; fallback is defensive.
    /* c8 ignore next 2 */
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
  // hosts[0] is always set by harvesters; fallback is defensive.
  /* c8 ignore next */
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
        // version is always set in package.json; fallback is defensive.
        /* c8 ignore next */
        return pkg.version ?? "0.0.0";
      } catch {
        // package.json read failed (e.g., ENOENT) — fallback to "0.0.0".
        /* c8 ignore next */
        console.warn(
          "ard-catalog: failed to read package.json version, using 0.0.0",
        );
        return "0.0.0";
      }
    })());

  const ardEntries: ArdCatalogEntry[] = [];
  for (const entry of entries) {
    try {
      ardEntries.push(mapEntryToArd(entry, getArdPublisherFqdn(), pkgVersion));
    } catch {
      // Skip entries that fail mapping (malformed data).
      console.warn(`ard-catalog: skipping malformed entry during ARD export`);
    }
  }

  const catalog: ArdCatalog = {
    $schema: ARD_SCHEMA_URI,
    publisher: getArdPublisherFqdn(),
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
  ARD_PUBLISHER_FQDN,
};
