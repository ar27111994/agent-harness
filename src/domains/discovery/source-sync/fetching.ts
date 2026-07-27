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

/** Number of entries fetched per paginated request (per_page / limit / rows / take)
 *  across all registries, and the batch window during source-sync import. */
export const SOURCE_SYNC_BATCH_SIZE = 50;

/**
 * Maximum number of catalog entries a single package-registry source may
 * contribute to the indexed catalog.  Aligns the Packagist (PHP) full-snapshot
 * source with the paginated registries (pypi: 500, cargo: 500, nuget: 500).
 * Prevents any single registry from dominating catalog composition and
 * degrading selection rates for unrelated workspaces.
 */
export const SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP = 500;
/** Default HTTP request timeout in milliseconds for source-sync fetches. */
export const SOURCE_SYNC_TIMEOUT_MS = 30_000;
/** Default HTTP headers sent with every source-sync request. */
export const SOURCE_SYNC_HEADERS = {
  Accept: "application/json,text/html,application/xml,text/plain,*/*",
  "User-Agent": "agent-harness",
};
/** Maximum retry attempts for transient source-sync fetch failures
 *  (fetchWithRetry performs 1 initial attempt + up to maxRetries retries). */
export const SOURCE_SYNC_MAX_RETRIES = 3;
/** Base backoff delay in ms for source-sync retries (exponential: delay × 2ⁿ). */
export const SOURCE_SYNC_RETRY_BASE_DELAY_MS = 1_000;
/** Base of the exponential backoff factor (2ⁿ). */
const EXPONENTIAL_BACKOFF_BASE = 2;
/** Minimum HTTP status code for client errors (4xx). */
const HTTP_STATUS_CLIENT_ERROR_MIN = 400;
/** Minimum HTTP status code for server errors (5xx). */
const HTTP_STATUS_SERVER_ERROR_MIN = 500;

// ─── Error classification ─────────────────────────────────────────────────────

/**
 * Error wrapper for failures where retrying is pointless (SSRF rejections,
 * 4xx client errors, invalid URLs, policy blocks). Callers can use
 * `instanceof NonTransientFetchError` for reliable error discrimination
 * instead of fragile string-matching on error messages.
 */
export class NonTransientFetchError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NonTransientFetchError";
  }
}

/**
 * Returns true when `err` is a NonTransientFetchError (explicit marker)
 * or has a known non-transient shape (HTTP 4xx, SSRF violation).
 *
 * Prefers structured checks over string-matching; falls back to message
 * inspection only for errors originating outside this module.
 */
export function isNonTransientError(err: unknown): boolean {
  if (err instanceof NonTransientFetchError) {
    return true;
  }

  // Guard: JS allows throwing non-Error values. Not testable without
  // triggering actual runtime throws of primitives/objects.
  /* c8 ignore next 2 */
  if (!(err instanceof Error)) {
    return false;
  }

  // HTTP status-code based: 4xx client errors are not transient.
  if (
    hasHttpStatus(err) &&
    err.status >= HTTP_STATUS_CLIENT_ERROR_MIN &&
    err.status < HTTP_STATUS_SERVER_ERROR_MIN
  ) {
    return true;
  }

  return false;
}

/**
 * Type guard: returns true when `err` has a numeric HTTP `status` property.
 */
export function hasHttpStatus(err: Error): err is Error & { status: number } {
  return typeof (err as unknown as Record<string, unknown>).status === "number";
}

// ─── Shared retry wrapper ──────────────────────────────────────────────────────

/**
 * Executes `fetchFn`, retrying on transient failures with exponential backoff.
 *
 * Non-transient errors (NonTransientFetchError, HTTP 4xx) are rethrown
 * immediately without retry. Transient errors retry up to `maxRetries` times
 * with delays of `baseDelayMs × 2ⁿ`.
 */
export async function fetchWithRetry<T>(
  url: string,
  fetchFn: () => Promise<T>,
  options: SourceSyncFetchOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? SOURCE_SYNC_MAX_RETRIES);
  const baseDelayMs =
    options.retryBaseDelayMs ?? SOURCE_SYNC_RETRY_BASE_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = baseDelayMs * EXPONENTIAL_BACKOFF_BASE ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await fetchFn();
    } catch (err) {
      lastError = err;
      if (isNonTransientError(err)) {
        throw err;
      }
      if (attempt === maxRetries) {
        throw err;
      }
    }
  }
  throw lastError;
}

// ─── Public fetch wrappers ─────────────────────────────────────────────────────

/**
 * Throws when `value` is null — guarded fetches return null for all
 * non-OK responses, SSRF rejections, and network errors. Since the
 * guarded layer doesn't propagate status info, we throw a plain Error
 * (transient) so fetchWithRetry can retry. The cost of extra retries
 * on permanent failures (4xx, SSRF) is bounded (~7 s with defaults);
 * the cost of NOT retrying on transient errors (5xx, timeouts) is
 * a permanently stale/failed source.
 */
function requireNonNull<T>(value: T | null, url: string): T {
  if (value === null) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return value;
}

/**
 * Fetches the URL as plain text with retry-on-transient-failure.
 * Throws when all retry attempts are exhausted or the request hits a
 * non-transient failure.
 */
export async function fetchRequiredText(
  url: string,
  allowedOrigins: readonly string[],
  options: SourceSyncFetchOptions = {},
): Promise<string> {
  return fetchWithRetry(
    url,
    async () =>
      requireNonNull(
        await fetchTextWithGuards(url, {
          allowedOrigins,
          headers: SOURCE_SYNC_HEADERS,
          maxBytes: options.maxBytes ?? SOURCE_SYNC_FETCH_MAX_BYTES,
          timeoutMs: options.timeoutMs ?? SOURCE_SYNC_TIMEOUT_MS,
        }),
        url,
      ),
    options,
  );
}

/**
 * Fetches the URL as parsed JSON with retry-on-transient-failure.
 * Throws when all retry attempts are exhausted or the request hits a
 * non-transient failure.
 */
export async function fetchRequiredJson(
  url: string,
  allowedOrigins: readonly string[],
  options: SourceSyncFetchOptions = {},
): Promise<unknown> {
  return fetchWithRetry(
    url,
    async () =>
      requireNonNull(
        await fetchJsonWithGuards(url, {
          allowedOrigins,
          headers: SOURCE_SYNC_HEADERS,
          maxBytes: options.maxBytes ?? SOURCE_SYNC_FETCH_MAX_BYTES,
          timeoutMs: options.timeoutMs ?? SOURCE_SYNC_TIMEOUT_MS,
        }),
        url,
      ),
    options,
  );
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
