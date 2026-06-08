/**
 * Reference entry construction for source-sync.
 *
 * Owns: URL path decoding, display name / manifest-entry derivation, and the
 * indexed-reference catalog entry builder. Depends only on fetching.ts URL
 * helpers and the external reference-source-harvester.
 */

import type { AssetCatalogEntry, SourceDefinition } from "../../../types.js";
import { buildReferenceSourceCatalogEntry } from "../reference-source-harvester.js";

import type { IndexedReferenceOptions, SourceSyncContext } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum path segment count required to form an owner/repo pair (e.g. Swift). */
export const MIN_OWNER_REPO_PATH_SEGMENTS = 2;

// ─── URL path utilities ───────────────────────────────────────────────────────

/**
 * Splits a URL pathname into decoded, non-empty path segments.
 */
export function decodePathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Derives a human-readable display name from the last non-empty URL path segment.
 * Falls back to the hostname when the path is empty.
 */
export function buildDisplayNameFromUrl(url: URL): string {
  const segments = decodePathSegments(url.pathname).filter(
    (segment) => segment.length > 0,
  );
  if (segments.length === 0) {
    return url.hostname;
  }

  return segments[segments.length - 1]!;
}

/**
 * Derives a slash-joined manifest entry string from the non-empty URL path
 * segments. Returns undefined when the path has no meaningful segments.
 */
export function buildManifestEntryFromUrl(url: URL): string | undefined {
  const segments = decodePathSegments(url.pathname).filter(
    (segment) => segment.length > 0,
  );
  if (segments.length === 0) {
    return undefined;
  }

  return segments.join("/");
}

// ─── Package name extractors ──────────────────────────────────────────────────

/**
 * Extracts the PyPI package name from a URL of the form `/project/<name>/`.
 * Returns undefined when the path does not start with `/project/`.
 */
export function extractPypiPackageNameFromUrl(url: URL): string | undefined {
  const segments = decodePathSegments(url.pathname);
  if (segments[0] !== "project") {
    return undefined;
  }
  return segments[1];
}

/**
 * Extracts the `owner/repo` package name from a Swift Package Index URL.
 * Returns undefined when the path has fewer than two segments.
 */
export function extractSwiftPackageNameFromUrl(url: URL): string | undefined {
  const segments = decodePathSegments(url.pathname);
  if (segments.length < MIN_OWNER_REPO_PATH_SEGMENTS) {
    return undefined;
  }
  return `${segments[0]}/${segments[1]}`;
}

// ─── Indexed reference item construction ─────────────────────────────────────

/**
 * Builds an indexed catalog entry for a reference source item discovered via
 * URL (sitemap, HTML page link, marketplace API, etc.).
 */
export function buildIndexedReferenceItem(
  source: SourceDefinition,
  context: SourceSyncContext,
  url: URL,
  options: IndexedReferenceOptions,
): AssetCatalogEntry {
  const manifestEntry =
    options.manifestEntry ?? buildManifestEntryFromUrl(url) ?? url.toString();
  const effectiveDisplayName =
    options.displayName ?? buildDisplayNameFromUrl(url);
  return buildReferenceSourceCatalogEntry(
    source,
    context.demandProfile,
    context.selectionRegistry,
    {
      harvestedItem: {
        displayName: effectiveDisplayName,
        originUrl: url.toString(),
        summary:
          options.summary ??
          `${source.name} indexed item for ${effectiveDisplayName}`,
        capabilities: decodePathSegments(url.pathname),
        assetKind: options.assetKind,
        compatibilityMode: options.compatibilityMode,
        installMethod: options.installMethod,
        manifestEntry,
        installs: options.installs,
        lastUpdated: options.lastUpdated,
      },
    },
  );
}
