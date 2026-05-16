import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { TextDecoder } from "node:util";

import { getRuntimeConfig } from "../config/runtime.js";

/**
 * Describes resolved hostname address data exchanged by the lifecycle pipeline.
 */
export interface ResolvedHostnameAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Defines the supported hostname resolver values.
 */
export type HostnameResolver = (
  hostname: string,
) => Promise<ResolvedHostnameAddress[]>;

/**
 * Defines the supported guarded request body values.
 */
export type GuardedRequestBody =
  | string
  | Buffer
  | URLSearchParams
  | ArrayBuffer
  | ArrayBufferView
  | null
  | undefined;

/**
 * Describes fetch with guards options data exchanged by the lifecycle pipeline.
 */
export interface FetchWithGuardsOptions {
  allowedOrigins?: readonly string[];
  body?: GuardedRequestBody;
  headers?: HeadersInit;
  maxBytes?: number;
  method?: string;
  resolveHostname?: HostnameResolver;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_FETCH = globalThis.fetch;
type HttpsRequest = typeof request;
let httpsRequest: HttpsRequest = request;

function setHttpsRequestForTests(nextRequest: HttpsRequest): () => void {
  const previousRequest = httpsRequest;
  httpsRequest = nextRequest;
  return () => {
    httpsRequest = previousRequest;
  };
}

/**
 * Performs an HTTP(S) fetch with a timeout. Origin allowlists are enforced by
 * the higher-level guarded fetch helpers.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = getRuntimeConfig().http.timeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = (): void => {
    controller.abort(options.signal?.reason);
  };
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Fetches text from an explicitly allowed origin without buffering more than
 * the configured byte limit into memory.
 */
export async function fetchTextWithGuards(
  url: string,
  options: FetchWithGuardsOptions = {},
): Promise<string | null> {
  const httpConfig = getRuntimeConfig().http;

  try {
    const { addresses, parsedUrl } =
      await resolveAllowedPublicHttpUrlForRequest(
        url,
        options.allowedOrigins ?? [],
        options.resolveHostname,
      );
    const response = await fetchResolvedUrl(
      parsedUrl,
      addresses,
      options,
      options.timeoutMs ?? httpConfig.timeoutMs,
    );

    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    return await readResponseTextWithLimit(
      response,
      options.maxBytes ?? httpConfig.maxResponseBytes,
      options.timeoutMs ?? httpConfig.timeoutMs,
    );
  } catch {
    return null;
  }
}

/**
 * Fetches bytes with guards with the configured runtime safeguards.
 */
export async function fetchBytesWithGuards(
  url: string,
  options: FetchWithGuardsOptions = {},
): Promise<Buffer | null> {
  const httpConfig = getRuntimeConfig().http;

  try {
    const { addresses, parsedUrl } =
      await resolveAllowedPublicHttpUrlForRequest(
        url,
        options.allowedOrigins ?? [],
        options.resolveHostname,
      );
    const response = await fetchResolvedUrl(
      parsedUrl,
      addresses,
      options,
      options.timeoutMs ?? httpConfig.timeoutMs,
    );

    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    return await readResponseBytesWithLimit(
      response,
      options.maxBytes ?? httpConfig.maxResponseBytes,
      options.timeoutMs ?? httpConfig.timeoutMs,
    );
  } catch {
    return null;
  }
}

/**
 * Fetches JSON with the same URL and response-size guards as text fetches.
 */
export async function fetchJsonWithGuards(
  url: string,
  options: FetchWithGuardsOptions = {},
): Promise<unknown | null> {
  const text = await fetchTextWithGuards(url, options);
  if (text === null) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Validates that a URL is HTTPS and belongs to one of the provided origins.
 */
export function assertAllowedPublicHttpUrl(
  url: string,
  allowedOrigins: readonly string[],
): URL {
  const parsedUrl = assertAllowedHttpUrl(url, allowedOrigins);
  assertPublicInternetHostname(parsedUrl);
  return parsedUrl;
}

/**
 * Validates unknown data as allowed public http url with dns.
 */
export async function assertAllowedPublicHttpUrlWithDns(
  url: string,
  allowedOrigins: readonly string[],
  resolveHostname: HostnameResolver = resolveHostnameWithDns,
): Promise<URL> {
  const { parsedUrl } = await resolveAllowedPublicHttpUrlForRequest(
    url,
    allowedOrigins,
    resolveHostname,
  );
  return parsedUrl;
}

/**
 * Validates unknown data as allowed http url.
 */
export function assertAllowedHttpUrl(
  url: string,
  allowedOrigins: readonly string[],
): URL {
  const parsedUrl = new URL(url);
  const normalizedAllowedOrigins = new Set(
    allowedOrigins.map((origin) => origin.toLowerCase()),
  );

  if (parsedUrl.protocol !== "https:") {
    throw new Error(`Only https URLs can be fetched: ${url}`);
  }

  if (!normalizedAllowedOrigins.has(parsedUrl.origin.toLowerCase())) {
    throw new Error(`URL origin is not allowed: ${parsedUrl.origin}`);
  }

  return parsedUrl;
}

/**
 * Validates unknown data as public internet hostname.
 */
export function assertPublicInternetHostname(parsedUrl: URL): void {
  const hostname = normalizeHostname(parsedUrl);

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`URL hostname is not public: ${parsedUrl.hostname}`);
  }

  if (isNonPublicIpAddress(hostname)) {
    throw new Error(`URL hostname is not public: ${parsedUrl.hostname}`);
  }
}

/**
 * Validates unknown data as public internet resolution.
 */
export async function assertPublicInternetResolution(
  parsedUrl: URL,
  resolveHostname: HostnameResolver = resolveHostnameWithDns,
): Promise<void> {
  await resolvePublicInternetAddresses(parsedUrl, resolveHostname);
}

async function resolveAllowedPublicHttpUrlForRequest(
  url: string,
  allowedOrigins: readonly string[],
  resolveHostname: HostnameResolver = resolveHostnameWithDns,
): Promise<{ parsedUrl: URL; addresses: ResolvedHostnameAddress[] }> {
  const parsedUrl = assertAllowedPublicHttpUrl(url, allowedOrigins);
  const addresses = await resolvePublicInternetAddresses(
    parsedUrl,
    resolveHostname,
  );
  return { parsedUrl, addresses };
}

async function resolvePublicInternetAddresses(
  parsedUrl: URL,
  resolveHostname: HostnameResolver,
): Promise<ResolvedHostnameAddress[]> {
  const hostname = normalizeHostname(parsedUrl);
  const ipVersion = isIP(hostname);
  const addresses =
    ipVersion === 4
      ? [{ address: hostname, family: 4 as const }]
      : ipVersion === 6
        ? [{ address: hostname, family: 6 as const }]
        : await resolveHostname(hostname);

  if (addresses.length === 0) {
    throw new Error(`URL hostname did not resolve: ${parsedUrl.hostname}`);
  }

  for (const address of addresses) {
    if (isNonPublicIpAddress(address.address)) {
      throw new Error(
        `URL hostname resolves to a non-public address: ${parsedUrl.hostname}`,
      );
    }
  }

  return addresses;
}

async function fetchResolvedUrl(
  parsedUrl: URL,
  addresses: readonly ResolvedHostnameAddress[],
  options: FetchWithGuardsOptions,
  timeoutMs: number,
): Promise<Response> {
  if (shouldUseTestFetchMock()) {
    const body = serializeRequestBody(options.body);
    return fetchWithTimeout(
      parsedUrl.toString(),
      {
        body: toFetchBody(body),
        headers: buildRequestHeaders(options.headers, body),
        method: resolveRequestMethod(options.method, body),
        redirect: "error",
        signal: options.signal,
      },
      timeoutMs,
    );
  }

  return fetchWithPinnedResolution(parsedUrl, addresses, options, timeoutMs);
}

function resolveRequestMethod(
  requestedMethod: string | undefined,
  body: string | Buffer | null,
): string {
  return requestedMethod ?? (body ? "POST" : "GET");
}

function toFetchBody(body: string | Buffer | null): BodyInit | null {
  if (body === null || typeof body === "string") {
    return body;
  }

  return body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer;
}

function shouldUseTestFetchMock(): boolean {
  return (
    process.env.AGENT_HARNESS_TEST_FETCH_MOCKS === "1" &&
    globalThis.fetch !== DEFAULT_FETCH
  );
}

async function fetchWithPinnedResolution(
  parsedUrl: URL,
  addresses: readonly ResolvedHostnameAddress[],
  options: FetchWithGuardsOptions,
  timeoutMs: number,
): Promise<Response> {
  if (addresses.length === 0) {
    throw new Error(`URL hostname did not resolve: ${parsedUrl.hostname}`);
  }

  const controller = new AbortController();
  const abortFromCaller = (): void => {
    controller.abort(options.signal?.reason);
  };
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    let lastError: unknown = null;
    for (const address of addresses) {
      try {
        return await requestWithPinnedAddress(
          parsedUrl,
          address,
          options,
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`All resolved addresses failed for ${parsedUrl.hostname}`);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function requestWithPinnedAddress(
  parsedUrl: URL,
  address: ResolvedHostnameAddress,
  options: FetchWithGuardsOptions,
  signal: AbortSignal,
): Promise<Response> {
  const body = serializeRequestBody(options.body);
  const headers = buildRequestHeaders(options.headers, body);
  const pinnedLookup = createPinnedLookup(address);

  return new Promise((resolve, reject) => {
    const requestMessage = httpsRequest(
      parsedUrl,
      {
        headers,
        lookup: pinnedLookup,
        method: resolveRequestMethod(options.method, body),
        signal,
      },
      (responseMessage) => {
        resolve(
          new Response(Readable.toWeb(responseMessage) as ReadableStream, {
            headers: buildResponseHeaders(responseMessage.headers),
            status: responseMessage.statusCode ?? 502,
            statusText: responseMessage.statusMessage,
          }),
        );
      },
    );
    requestMessage.on("error", reject);
    if (body) {
      requestMessage.write(body);
    }
    requestMessage.end();
  });
}

/**
 * Builds a DNS lookup override pinned to a single resolved address while
 * honoring Node's single-result and all-results lookup callback modes.
 */
export function createPinnedLookup(
  address: ResolvedHostnameAddress,
): LookupFunction {
  return (_hostname, options, callback) => {
    const resolvedCallback = typeof options === "function" ? options : callback;

    if (!resolvedCallback) {
      throw new TypeError("DNS lookup callback is required.");
    }

    const all =
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      options.all === true;

    if (all) {
      resolvedCallback(null, [address]);
      return;
    }

    resolvedCallback(null, address.address, address.family);
  };
}

function serializeRequestBody(
  body: GuardedRequestBody,
): string | Buffer | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body === "string" || Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  throw new Error("Unsupported guarded request body type.");
}

function buildRequestHeaders(
  headers: HeadersInit | undefined,
  body: string | Buffer | null,
): Record<string, string> {
  const requestHeaders = new Headers(headers);
  if (body && !requestHeaders.has("content-length")) {
    requestHeaders.set("content-length", String(Buffer.byteLength(body)));
  }

  return Object.fromEntries(requestHeaders.entries());
}

function buildResponseHeaders(headers: IncomingHttpHeaders): Headers {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        responseHeaders.append(name, item);
      }
    } else if (value !== undefined) {
      responseHeaders.set(name, String(value));
    }
  }
  return responseHeaders;
}

function normalizeHostname(parsedUrl: URL): string {
  return parsedUrl.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
}

async function resolveHostnameWithDns(
  hostname: string,
): Promise<ResolvedHostnameAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((address) => ({
    address: address.address,
    family: address.family as 4 | 6,
  }));
}

function isNonPublicIpAddress(hostname: string): boolean {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isPrivateIpv4Address(hostname);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6Address(hostname);
  }

  return false;
}

function isPrivateIpv4Address(hostname: string): boolean {
  const octets = hostname.split(".").map((octet) => Number(octet));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 88 && octets[2] === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    first >= 224
  );
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  const mappedIpv4Prefix = "::ffff:";
  const siitMappedIpv4Prefix = "::ffff:0:";

  if (normalizedHostname.startsWith(siitMappedIpv4Prefix)) {
    return true;
  }

  if (normalizedHostname.startsWith(mappedIpv4Prefix)) {
    return isPrivateIpv4Address(
      normalizedHostname.slice(mappedIpv4Prefix.length),
    );
  }

  const firstGroup = normalizedHostname.split(":")[0]!;
  const firstGroupValue = Number.parseInt(firstGroup, 16);

  return (
    normalizedHostname === "::" ||
    normalizedHostname === "::1" ||
    (Number.isFinite(firstGroupValue) &&
      firstGroupValue === 0x2001 &&
      normalizedHostname.split(":")[1] === "db8") ||
    firstGroupValue === 0x2002 ||
    (firstGroupValue >= 0xfc00 && firstGroupValue <= 0xfdff) ||
    (firstGroupValue >= 0xfe80 && firstGroupValue <= 0xfeff)
  );
}

/**
 * Reads a response body while enforcing a maximum byte count before decoding.
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  timeoutMs = getRuntimeConfig().http.timeoutMs,
): Promise<string> {
  const bytes = await readResponseBytesWithLimit(response, maxBytes, timeoutMs);
  return new TextDecoder().decode(bytes);
}

/**
 * Reads response bytes with limit from project state.
 */
export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  timeoutMs = getRuntimeConfig().http.timeoutMs,
): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsedContentLength = Number(contentLength);
    if (
      Number.isFinite(parsedContentLength) &&
      parsedContentLength > maxBytes
    ) {
      await response.body?.cancel();
      throw new Error(
        `Response body exceeds the configured limit (${parsedContentLength} > ${maxBytes} bytes).`,
      );
    }
  }

  if (!response.body) {
    const bytes = Buffer.from(
      await withBodyReadTimeout(response.arrayBuffer(), timeoutMs, () =>
        response.body?.cancel(),
      ),
    );
    ensureBytesWithinLimit(bytes.byteLength, maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await withBodyReadTimeout(
        reader.read(),
        timeoutMs,
        () => reader.cancel(),
      );
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        ensureBytesWithinLimit(totalBytes, maxBytes);
      }

      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  return Buffer.from(concatenateChunks(chunks, totalBytes));
}

async function withBodyReadTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  cleanup?: () => Promise<void> | void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void Promise.resolve(cleanup?.())
        .catch(() => undefined)
        .then(() => {
          reject(
            new Error(
              `Timed out while reading response body after ${timeoutMs}ms.`,
            ),
          );
        });
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function ensureBytesWithinLimit(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new Error(
      `Response body exceeds the configured limit (${bytes} > ${maxBytes} bytes).`,
    );
  }
}

function concatenateChunks(
  chunks: Uint8Array[],
  totalBytes: number,
): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

/**
 * Exposes narrow HTTP internals for focused behavioral coverage.
 */
export const httpInternals = {
  fetchWithPinnedResolution,
  requestWithPinnedAddress,
  serializeRequestBody,
  buildResponseHeaders,
  isPrivateIpv4Address,
  isPrivateIpv6Address,
  withBodyReadTimeout,
  setHttpsRequestForTests,
};
