import { TextDecoder } from "node:util";

export interface FetchWithGuardsOptions {
  allowedOrigins?: readonly string[];
  headers?: HeadersInit;
  maxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

/**
 * Performs an HTTP(S) fetch with a timeout after validating the destination
 * origin against an explicit allowlist.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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
      { headers: options.headers },
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
