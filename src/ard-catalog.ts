/**
 * ARD (Agentic Resource Discovery) 1.0 catalog export.
 *
 * Maps selected Agent Harness assets to the current public ai-catalog schema
 * and writes `.well-known/ai-catalog.json` atomically.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { STOPWORD_TOKENS } from "./domains/discovery/catalog-utils.js";
import {
  ARD_SPEC_VERSION,
  ASSET_KIND_TO_ARD_TYPE,
  getArdPublisherFqdn,
} from "./ard/types.js";
import type { AssetCatalogEntry } from "./types.js";

/** ARD 1.0 trust manifest subset emitted by Agent Harness. */
export interface ArdTrustManifest {
  identity: string;
  identityType?: "spiffe" | "did" | "https" | "other";
}

interface ArdCatalogEntryBase {
  identifier: string;
  displayName: string;
  type: string;
  description?: string;
  capabilities?: string[];
  representativeQueries?: string[];
  version?: string;
  updatedAt?: string;
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
  trustManifest?: ArdTrustManifest;
}

/** ARD requires exactly one of `url` and `data`. */
export type ArdCatalogEntry = ArdCatalogEntryBase &
  (
    | { url: string; data?: never }
    | { data: Record<string, unknown>; url?: never }
  );

/** Current public ARD ai-catalog root object. */
export interface ArdCatalog {
  specVersion: typeof ARD_SPEC_VERSION;
  host?: {
    displayName: string;
    identifier?: string;
    documentationUrl?: string;
    trustManifest?: ArdTrustManifest;
  };
  entries: ArdCatalogEntry[];
}

/** Re-export publisher FQDN helper for external callers. */
export { getArdPublisherFqdn };

/**
 * Builds a current ARD identifier.
 * Format: `urn:air:<publisher>:<namespace>:<asset-name>`.
 */
export function buildArdUrn(
  entry: AssetCatalogEntry,
  publisherFqdn: string,
): string {
  const namespace = sanitizeUrnSegment(entry.source.sourceKind, "asset");
  const sanitized = sanitizeUrnSegment(entry.id, "asset").slice(0, 50);
  let hash = 5381;
  for (let index = 0; index < entry.id.length; index += 1) {
    hash = ((hash << 5) + hash + entry.id.charCodeAt(index)) | 0;
  }
  const hashSuffix = (hash >>> 0).toString(16).padStart(8, "0");
  return `urn:air:${sanitizePublisherFqdn(publisherFqdn)}:${namespace}:${sanitized}-${hashSuffix}`;
}

function sanitizePublisherFqdn(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return sanitized || "agent-harness.local";
}

function sanitizeUrnSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return sanitized || fallback;
}

/**
 * Emits a minimal ARD 1.0 trust identity only when Agent Harness has a reason
 * to claim publisher identity. Local trust flags are not converted into ARD
 * attestations because the public schema requires verifiable URI/mediaType
 * evidence for every attestation.
 */
export function deriveArdTrustManifest(
  entry: AssetCatalogEntry,
): ArdTrustManifest | undefined {
  const meaningfulTier =
    entry.source.authorityTier === "official-first-party" ||
    entry.source.authorityTier === "official-compatible" ||
    entry.source.authorityTier === "trusted-community";
  if (
    !entry.source.publisherVerified &&
    !meaningfulTier &&
    entry.trust.signals.length === 0
  ) {
    return undefined;
  }

  return {
    identity: `https://${getArdPublisherFqdn()}`,
    identityType: "https",
  };
}

/** Omits missing, invalid, or epoch-sentinel update timestamps. */
export function resolveArdUpdatedAt(
  entry: AssetCatalogEntry,
): string | undefined {
  const raw = entry.maintenance.lastUpdated;
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return new Date(timestamp).toISOString();
}

/** Maps one Agent Harness asset to a schema-valid ARD 1.0 entry. */
export function mapEntryToArd(
  entry: AssetCatalogEntry,
  publisherFqdn: string,
  version: string,
): ArdCatalogEntry {
  const common: ArdCatalogEntryBase = {
    identifier: buildArdUrn(entry, publisherFqdn),
    displayName: entry.displayName,
    type: ASSET_KIND_TO_ARD_TYPE[entry.assetKind] ?? "application/ai-skill",
    description: `${entry.assetKind} asset from ${entry.source.sourceId} (${entry.source.sourceKind})`,
    capabilities: entry.capabilities.slice(0, 20),
    representativeQueries: buildRepresentativeQueries(entry).slice(0, 5),
    version,
    updatedAt: resolveArdUpdatedAt(entry),
    tags: [
      entry.assetKind,
      entry.source.sourceKind,
      entry.compatibilityMode,
      ...entry.hosts.slice(0, 5),
      entry.source.authorityTier,
    ],
    metadata: {
      assetKind: entry.assetKind,
      sourceId: entry.source.sourceId,
      compatibilityMode: entry.compatibilityMode,
    },
    trustManifest: deriveArdTrustManifest(entry),
  };

  const originUrl = resolveHttpUrl(entry.source.originUrl);
  if (originUrl) {
    return { ...common, url: originUrl };
  }

  // The public schema allows inline data instead of a URL. This fallback keeps
  // local/catalog-only entries valid without inventing a resolvable URL.
  return {
    ...common,
    data: {
      assetKind: entry.assetKind,
      sourceId: entry.source.sourceId,
      compatibilityMode: entry.compatibilityMode,
      manifestEntry: entry.install.manifestEntry ?? null,
    },
  };
}

function resolveHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function buildRepresentativeQueries(entry: AssetCatalogEntry): string[] {
  const queries = [
    `What ${entry.assetKind} assets are available from ${entry.source.sourceId}?`,
    `Find ${entry.displayName.toLowerCase()} for ${entry.hosts[0] ?? "agent"} workflows`,
  ];

  const meaningfulCapabilities = entry.capabilities
    .filter((capability) => {
      const normalized = capability.toLowerCase();
      return (
        normalized.length >= 2 &&
        !/^\d+$/u.test(normalized) &&
        !STOPWORD_TOKENS.has(normalized)
      );
    })
    .slice(0, 3);

  for (const capability of meaningfulCapabilities) {
    queries.push(`Install a ${entry.assetKind} for ${capability}`);
  }
  return [...new Set(queries)].slice(0, 5);
}

/** Formatter signature injected by tests or backed by Prettier at runtime. */
export type PrettierFormatter = (
  source: string,
  options: {
    parser: string;
    endOfLine: "lf" | "crlf" | "cr" | "auto";
    trailingComma: "all" | "es5" | "none";
  },
) => Promise<string>;

/** Writes the selected catalog as ARD 1.0 JSON. */
export async function writeArdCatalog(
  projectRoot: string,
  version?: string,
  formatWithPrettier?: PrettierFormatter,
): Promise<{ filePath: string; entryCount: number }> {
  const { readJsonLinesFile } = await import("./files.js");
  const catalogPath = join(
    projectRoot,
    "discover",
    "output",
    "catalog.selected.jsonl",
  );
  const wellKnownDir = join(projectRoot, ".well-known");
  const entries = await readJsonLinesFile<AssetCatalogEntry>(catalogPath);
  const packageVersion = version ?? (await readPackageVersion(projectRoot));

  const ardEntries: ArdCatalogEntry[] = [];
  for (const entry of entries) {
    try {
      ardEntries.push(
        mapEntryToArd(entry, getArdPublisherFqdn(), packageVersion),
      );
    } catch (error: unknown) {
      console.warn(
        `ard-catalog: skipping malformed entry (${entry.id || entry.displayName || "(unknown)"}): ${extractErrorMessage(error)}`,
      );
    }
  }

  const publisherFqdn = getArdPublisherFqdn();
  const catalog: ArdCatalog = {
    specVersion: ARD_SPEC_VERSION,
    host: {
      displayName: "Agent Harness",
      identifier: `https://${publisherFqdn}`,
      documentationUrl: "https://github.com/ar27111994/agent-harness",
      trustManifest: {
        identity: `https://${publisherFqdn}`,
        identityType: "https",
      },
    },
    entries: ardEntries,
  };

  await mkdir(wellKnownDir, { recursive: true });
  const filePath = join(wellKnownDir, "ai-catalog.json");
  const rawJson = `${JSON.stringify(catalog, null, 2)}\n`;
  let formattedJson = rawJson;
  try {
    const formatter = formatWithPrettier ?? defaultPrettierFormatter;
    formattedJson = await formatter(rawJson, {
      parser: "json",
      endOfLine: "lf",
      trailingComma: "all",
    });
  } catch (error: unknown) {
    console.warn(
      `ard-catalog: Prettier formatting skipped (${extractErrorMessage(error)}). JSON output is valid but may not pass prettier --check.`,
    );
  }

  const tempPath = `${filePath}.tmp-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tempPath, formattedJson, "utf8");
  await rename(tempPath, filePath);
  return { filePath, entryCount: ardEntries.length };
}

async function readPackageVersion(projectRoot: string): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    console.warn(
      "ard-catalog: failed to read package.json version, using 0.0.0",
    );
    return "0.0.0";
  }
}

async function defaultPrettierFormatter(
  source: string,
  options: {
    parser: string;
    endOfLine: "lf" | "crlf" | "cr" | "auto";
    trailingComma: "all" | "es5" | "none";
  },
): Promise<string> {
  const prettier = await import("prettier");
  return prettier.format(source, options);
}

/** Extracts a readable message from an unknown thrown value. */
export function extractErrorMessage(error: unknown): string {
  /* c8 ignore next 3 */
  if (!(error instanceof Error)) {
    return String(error ?? "unknown error");
  }
  return error.message;
}

/** Exposes ARD conversion helpers for focused tests without widening runtime APIs. */
export const ardCatalogInternals = {
  resolveHttpUrl,
  sanitizePublisherFqdn,
  sanitizeUrnSegment,
  buildRepresentativeQueries,
};
