/**
 * Guarded fetch helpers and SSRF-safe origin construction for source-sync.
 *
 * Owns: source-sync-specific fetch wrappers, allowed-origin derivation from
 * checked-in source endpoints, URL normalization, sitemap/HTML link extraction,
 * and deduplication. The actual public-hostname / IP SSRF backstop lives in
 * lib/http.ts; this module only builds per-source origin allowlists from
 * checked-in source definitions.
 *
 * SECURITY NOTE — getAllowedOrigins():
 *   Origins are derived from checked-in source definitions whose URLs are
 *   authored by source pack maintainers, not from arbitrary user-provided
 *   runtime input. The guarded fetch layer still enforces public-hostname and
 *   IP-range checks. Do NOT reuse this self-derived allowlist pattern for
 *   arbitrary user-provided runtime endpoints.
 */

import { fetchJsonWithGuards, fetchTextWithGuards } from "../../../lib/http.js";

import type { SourceSyncFetchOptions } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum bytes read from a standard source-sync HTTP response. */
export const SOURCE_SYNC_FETCH_MAX_BYTES = 5_000_000;
/** Maximum bytes read from a large-response source (e.g. full NuGet catalog page). */
export const SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES = 25_000_000;
/** Number of items requested per page in paginated registry API calls. */
export const SOURCE_SYNC_BATCH_SIZE = 50;
/** Default HTTP request timeout in milliseconds for source-sync fetches. */
export const SOURCE_SYNC_TIMEOUT_MS = 30_000;
/** Default HTTP headers sent with every source-sync request. */
export const SOURCE_SYNC_HEADERS = {
  Accept: "application/json,text/html,application/xml,text/plain,*/*",
  "User-Agent": "agent-harness",
};

// ─── Fetch wrappers ───────────────────────────────────────────────────────────

/**
 * Fetches the URL as plain text, throwing when the response is null or the
 * request fails the SSRF / byte-limit guards in lib/http.ts.
 */
export async function fetchRequiredText(
  url: string,
  allowedOrigins: readonly string[],
  options: SourceSyncFetchOptions = {},
): Promise<string> {
  const content = await fetchTextWithGuards(url, {
    allowedOrigins,
    headers: SOURCE_SYNC_HEADERS,
    maxBytes: options.maxBytes ?? SOURCE_SYNC_FETCH_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? SOURCE_SYNC_TIMEOUT_MS,
  });
  if (content === null) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return content;
}

/**
 * Fetches the URL as parsed JSON, throwing when the response is null or the
 * request fails the SSRF / byte-limit guards in lib/http.ts.
 */
export async function fetchRequiredJson(
  url: string,
  allowedOrigins: readonly string[],
  options: SourceSyncFetchOptions = {},
): Promise<unknown> {
  const content = await fetchJsonWithGuards(url, {
    allowedOrigins,
    headers: SOURCE_SYNC_HEADERS,
    maxBytes: options.maxBytes ?? SOURCE_SYNC_FETCH_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? SOURCE_SYNC_TIMEOUT_MS,
  });
  if (content === null) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return content;
}

// ─── Allowed-origin construction ──────────────────────────────────────────────

/**
 * Builds source-sync fetch origins from checked-in source definitions. Source
 * pack authors are trusted to point at legitimate registry/docs endpoints, while
 * guarded fetch still enforces the public-hostname/IP SSRF backstop. Do not
 * reuse this self-derived allowlist pattern for arbitrary user-provided runtime
 * endpoints.
 */
export function getAllowedOrigins(
  ...urls: Array<string | undefined>
): string[] {
  return [
    ...new Set(urls.flatMap((url) => getAllowedOrigin(url)).filter(Boolean)),
  ] as string[];
}

/**
 * Extracts the URL origin (scheme + host + port) from a URL string.
 * Returns an empty array when the URL is undefined or unparseable.
 */
export function getAllowedOrigin(url: string | undefined): string[] {
  if (!url) {
    return [];
  }
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
}

// ─── URL normalization ────────────────────────────────────────────────────────

/**
 * Resolves `rawUrl` relative to `baseUrl`, strips query and hash, and returns
 * the result in an array. Returns an empty array when the URL is unparseable.
 */
export function toSameOriginUrl(rawUrl: string, baseUrl: string): URL[] {
  try {
    return [stripUrlQueryAndHash(new URL(rawUrl, baseUrl))];
  } catch {
    return [];
  }
}

/**
 * Returns a copy of `url` with query string and hash fragment removed.
 */
export function stripUrlQueryAndHash(url: URL): URL {
  const normalizedUrl = new URL(url.toString());
  normalizedUrl.hash = "";
  normalizedUrl.search = "";
  return normalizedUrl;
}

/**
 * Returns true when `url.origin` is present in `allowedOrigins` (case-insensitive).
 */
export function isAllowedOriginUrl(
  url: URL,
  allowedOrigins: readonly string[],
): boolean {
  return allowedOrigins.some(
    (origin) => origin.toLowerCase() === url.origin.toLowerCase(),
  );
}

/**
 * Deduplicates a URL array by string identity, preserving first-seen order.
 */
export function dedupeUrls(urls: URL[]): URL[] {
  return [...new Map(urls.map((url) => [url.toString(), url])).values()];
}

// ─── Sitemap parsing ──────────────────────────────────────────────────────────

/**
 * Fetches the root sitemap index, resolves leaf sitemap URLs that pass the
 * optional predicate, and returns them sorted. Falls back to the root URL when
 * the index contains no `<sitemap>` entries (i.e. the root is itself a urlset).
 */
export async function resolveSitemapLeafUrls(
  rootSitemapUrl: string,
  allowedOrigins: readonly string[],
  leafSitemapPredicate?: (url: URL) => boolean,
): Promise<string[]> {
  const xml = await fetchRequiredText(rootSitemapUrl, allowedOrigins);
  const sitemapIndexUrls = parseSitemapIndex(xml, rootSitemapUrl).filter(
    (url) => isAllowedOriginUrl(url, allowedOrigins),
  );

  if (sitemapIndexUrls.length === 0) {
    return [rootSitemapUrl];
  }

  return sitemapIndexUrls
    .filter((url) => (leafSitemapPredicate ? leafSitemapPredicate(url) : true))
    .map((url) => url.toString())
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Parses `<sitemap><loc>…</loc></sitemap>` entries from a sitemap index XML
 * document and returns them as resolved URL objects.
 */
export function parseSitemapIndex(content: string, baseUrl: string): URL[] {
  return [...content.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/giu)].flatMap(
    (match) => toSameOriginUrl(match[1]!, baseUrl),
  );
}

/**
 * Parses `<url><loc>…</loc></url>` entries from a sitemap urlset XML document
 * and returns them as resolved URL objects.
 */
export function parseUrlSet(content: string, baseUrl: string): URL[] {
  return [...content.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/giu)].flatMap(
    (match) => toSameOriginUrl(match[1]!, baseUrl),
  );
}

/**
 * Extracts all href/path matches of `pattern` from `content`, resolves them
 * relative to `baseUrl`, filters to `allowedOrigins`, strips query/hash, and
 * deduplicates the result.
 */
export function extractNormalizedLinks(
  content: string,
  baseUrl: string,
  allowedOrigins: readonly string[],
  pattern: RegExp,
): URL[] {
  const matches = [...content.matchAll(pattern)]
    .flatMap((match) => toSameOriginUrl(match[0]!, baseUrl))
    .filter((url) => isAllowedOriginUrl(url, allowedOrigins))
    .map(stripUrlQueryAndHash);
  return dedupeUrls(matches);
}

// ─── Misc data helpers ────────────────────────────────────────────────────────

/**
 * Casts `value` to a plain object record. Returns an empty object when the
 * value is not a non-null, non-array object.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Returns true when `value` is a non-null, non-array plain object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns `value` as a string when it is a non-empty string; undefined otherwise.
 */
export function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Returns `value` as a number when it is a finite number; undefined otherwise.
 */
export function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Coerces `value` to a string when it is a string or finite number; returns
 * undefined for all other types.
 */
export function stringifyUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * Filters an array-like value to string elements. Returns an empty array when
 * the value is not an array.
 */
export function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Extracts the `.message` property from an `Error`, or coerces `error` to a
 * string for non-Error values.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
