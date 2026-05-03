import { isIP } from "node:net";
import { TextDecoder } from "node:util";

export interface FetchWithGuardsOptions {
  allowedOrigins?: readonly string[];
  body?: BodyInit;
  headers?: HeadersInit;
  maxBytes?: number;
  method?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

/**
 * Performs an HTTP(S) fetch with a timeout. Origin allowlists are enforced by
 * the higher-level guarded fetch helpers.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
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
  try {
    const parsedUrl = assertAllowedHttpUrl(url, options.allowedOrigins ?? []);
    const response = await fetchWithTimeout(
      parsedUrl.toString(),
      {
        body: options.body,
        headers: options.headers,
        method: options.method,
        redirect: "error",
        signal: options.signal,
      },
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    return await readResponseTextWithLimit(
      response,
      options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
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

export function assertPublicInternetHostname(parsedUrl: URL): void {
  const hostname = parsedUrl.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`URL hostname is not public: ${parsedUrl.hostname}`);
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4Address(hostname)) {
    throw new Error(`URL hostname is not public: ${parsedUrl.hostname}`);
  }

  if (ipVersion === 6 && isPrivateIpv6Address(hostname)) {
    throw new Error(`URL hostname is not public: ${parsedUrl.hostname}`);
  }
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
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
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

  const firstGroup = normalizedHostname.split(":")[0] ?? "";
  const firstGroupValue = Number.parseInt(firstGroup, 16);

  return (
    normalizedHostname === "::" ||
    normalizedHostname === "::1" ||
    (Number.isFinite(firstGroupValue) &&
      (firstGroupValue === 0x2002 ||
        (firstGroupValue >= 0xfc00 && firstGroupValue <= 0xfdff) ||
        (firstGroupValue >= 0xfe80 && firstGroupValue <= 0xfeff)))
  );
}

/**
 * Reads a response body while enforcing a maximum byte count before decoding.
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
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
    const text = await response.text();
    ensureTextWithinLimit(text, maxBytes);
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(
        `Response body exceeds the configured limit (${totalBytes} > ${maxBytes} bytes).`,
      );
    }

    chunks.push(value);
  }

  return new TextDecoder().decode(concatenateChunks(chunks, totalBytes));
}

function ensureTextWithinLimit(text: string, maxBytes: number): void {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > maxBytes) {
    throw new Error(
      `Response body exceeds the configured limit (${byteLength} > ${maxBytes} bytes).`,
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
