/**
 * ARD (Agentic Resource Discovery) 1.0 catalog export.
 *
 * Maps selected Agent Harness assets to the current public ARD schemas and
 * writes `.well-known/ard.json` (the ArdManifest consumers are REQUIRED to
 * fetch, spec v0.91 §5.1) plus `.well-known/ai-catalog.json` (the AI-catalog
 * predecessor manifest, kept as a legacy courtesy) — both atomically.
 */

import { mkdir, writeFile } from "node:fs/promises";
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

/**
 * ARD v0.91 ArdManifest root object for `/.well-known/ard.json`.
 *
 * The schema requires only `entries[]` of ArdEntry (each of which requires
 * identifier, displayName, type, and exactly one of url/data). Any other
 * top-level members are transport-defined and ignored by ARD, so the minimal
 * faithful shape omits the ai-catalog envelope fields entirely.
 */
export interface ArdManifest {
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

/** Writes the selected catalog as ARD 1.0 JSON (both manifest files). */
export async function writeArdCatalog(
  projectRoot: string,
  version?: string,
  formatWithPrettier?: PrettierFormatter,
): Promise<{ filePath: string; ardFilePath: string; entryCount: number }> {
  const { readJsonLinesFile, toPosixPath, filesInternals } =
    await import("./files.js");
  const { renameJsonWriteTemp } = filesInternals;
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

  // A 0-entry result means the discovery state produced nothing to publish —
  // e.g. a cold tree with no `discover/output/catalog.selected.jsonl`, or a
  // source universe whose every entry failed to map. Shipping an empty catalog
  // is exactly the "plausible-but-empty ARD asset" failure mode of #484, so we
  // fail the export loudly rather than write an empty `ai-catalog.json`. The
  // error names the missing discovery state so the operator knows to run a real
  // discovery pass first (not "written").
  if (ardEntries.length === 0) {
    throw new Error(
      `ard-export: refusing to write an empty ARD catalog — no discovery entries were produced from ${toPosixPath(catalogPath)}. Run a real discovery pass first (e.g. \`discover full\` or \`discover select\`) so the export has entries to publish.`,
    );
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
  // Spec v0.91 §5.1: consumers resolve `/.well-known/ard.json` (ArdManifest) as
  // the primary required source; the ai-catalog predecessor is a courtesy.
  const manifest: ArdManifest = { entries: ardEntries };

  await mkdir(wellKnownDir, { recursive: true });
  const filePath = join(wellKnownDir, "ai-catalog.json");
  const ardFilePath = join(wellKnownDir, "ard.json");
  const formatterAgent = formatWithPrettier ?? defaultPrettierFormatter;
  // #489 (review finding 4): the two manifests must advance as ONE generation.
  // Stage BOTH to temp siblings first, then activate both together. A failure
  // while formatting/writing a temp can therefore never leave ai-catalog.json
  // at a newer generation than ard.json — the prior two independent
  // writeJsonAtomic calls could split them if the second write/rename failed.
  const formatJson = async (value: unknown): Promise<string> => {
    const rawJson = `${JSON.stringify(value, null, 2)}\n`;
    try {
      return await formatterAgent(rawJson, {
        parser: "json",
        endOfLine: "lf",
        trailingComma: "all",
      });
    } catch (error: unknown) {
      console.warn(
        `ard-catalog: Prettier formatting skipped (${extractErrorMessage(error)}). JSON output is valid but may not pass prettier --check.`,
      );
      return rawJson;
    }
  };
  const stageTemp = async (
    targetPath: string,
    value: unknown,
  ): Promise<{ tempPath: string; targetPath: string }> => {
    const tempPath = `${targetPath}.tmp-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tempPath, await formatJson(value), "utf8");
    return { tempPath, targetPath };
  };
  const staged = [
    await stageTemp(filePath, catalog),
    await stageTemp(ardFilePath, manifest),
  ];
  // Activate the pair by renaming both staged temps onto their destinations.
  // Reuses the shared atomic-rename retry (bounded EPERM/EACCES backoff with a
  // remove-and-retry fallback) so a momentarily-locked destination (AV scan,
  // open handle) never leaves the pair split. Readers observe each destination
  // as old-file → no-file → complete new-file at every point.
  for (const { tempPath, targetPath } of staged) {
    await renameJsonWriteTemp(tempPath, targetPath);
  }
  return { filePath, ardFilePath, entryCount: ardEntries.length };
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
