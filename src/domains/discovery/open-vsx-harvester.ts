import type { DemandProfile, SourceDefinition } from "../../types.js";
import { fetchTextWithGuards } from "../../lib/http.js";
import type { HarvestedReferenceItem } from "./reference-harvesters.js";

const OPEN_VSX_ORIGIN = "https://open-vsx.org";
const DEFAULT_SEARCH_ENDPOINT = `${OPEN_VSX_ORIGIN}/api/-/search`;
const MAX_RESULTS = 25;

/**
 * Harvests a bounded Open VSX search page into VS Code-compatible extension
 * candidates. This is a registry API, not a documentation scrape.
 */
export async function harvestOpenVsxExtensions(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
): Promise<HarvestedReferenceItem[]> {
  const endpoint = resolveOpenVsxEndpoint(source);
  const url = new URL(endpoint);
  url.searchParams.set("query", buildOpenVsxQuery(demandProfile));
  url.searchParams.set("size", String(MAX_RESULTS));
  url.searchParams.set("offset", "0");

  const text = await fetchTextWithGuards(url.toString(), {
    allowedOrigins: [OPEN_VSX_ORIGIN],
    headers: { Accept: "application/json" },
    timeoutMs: 10_000,
  });
  if (text === null) {
    return [];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return [];
  }

  return readExtensionRecords(payload)
    .slice(0, MAX_RESULTS)
    .flatMap((record) => {
      const namespace =
        readString(record.namespace) ??
        (isRecord(record.namespace)
          ? readString(record.namespace.name)
          : undefined);
      const name = readString(record.name);
      if (!namespace || !name) {
        return [];
      }

      const displayName =
        readString(record.displayName) ?? `${namespace}.${name}`;
      const description = readString(record.description) ?? "";
      const version = readString(record.version);
      const timestamp = readString(record.timestamp);
      const downloadCount = readFiniteNumber(record.downloadCount) ?? 0;
      const extensionId = `${namespace}.${name}`;

      return [
        {
          displayName,
          originUrl: `${OPEN_VSX_ORIGIN}/extension/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
          summary: description,
          capabilities: uniqueStrings([
            "open-vsx",
            "vscode-extension",
            "extension",
            ...tokenize(displayName),
            ...tokenize(description),
          ]),
          assetKind: "extension" as const,
          compatibilityMode: "native" as const,
          installMethod: "open-vsx-registry",
          manifestEntry: extensionId,
          publisherName: namespace,
          // The Open VSX registry publisher is trusted only when the response
          // explicitly carries namespace/publisher verification evidence.
          publisherVerified: readPublisherVerification(record),
          installs: downloadCount,
          lastUpdated: timestamp,
          ...(version ? { version } : {}),
          trustSignals: ["official-compatible-registry"],
        } satisfies HarvestedReferenceItem,
      ];
    });
}

function resolveOpenVsxEndpoint(source: SourceDefinition): string {
  const candidate =
    source.endpoints.apiUrl ??
    source.endpoints.searchUrl ??
    source.endpoints.repo;
  if (!candidate) {
    return DEFAULT_SEARCH_ENDPOINT;
  }

  try {
    const url = new URL(candidate);
    return url.origin.toLowerCase() === OPEN_VSX_ORIGIN
      ? url.toString()
      : DEFAULT_SEARCH_ENDPOINT;
  } catch {
    return DEFAULT_SEARCH_ENDPOINT;
  }
}

function buildOpenVsxQuery(demandProfile: DemandProfile | null): string {
  if (!demandProfile) {
    return "ai agent coding";
  }
  const terms = [
    ...demandProfile.signals.languages.slice(0, 2),
    ...demandProfile.signals.frameworks.slice(0, 2),
    ...demandProfile.signals.concerns.slice(0, 2),
    ...demandProfile.signals.tooling.slice(0, 2),
  ]
    .map((term) => term.trim())
    .filter(Boolean);
  return terms.length > 0 ? terms.join(" ") : "ai agent coding";
}

function readExtensionRecords(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }

  const nestedExtensions = isRecord(value.extensions)
    ? (value.extensions.results ?? value.extensions.items)
    : undefined;
  const candidates = [
    value.extensions,
    nestedExtensions,
    value.results,
    value.items,
  ];
  const raw = candidates.find(Array.isArray);
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readPublisherVerification(record: Record<string, unknown>): boolean {
  const namespace = isRecord(record.namespace) ? record.namespace : undefined;
  const publisher = isRecord(record.publisher) ? record.publisher : undefined;
  const candidates = [
    record.publisherVerified,
    record.namespaceVerified,
    publisher?.verified,
    namespace?.verified,
  ];
  return (
    candidates.find((value): value is boolean => typeof value === "boolean") ??
    false
  );
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/** Exposes Open VSX parsing helpers for focused tests. */
export const openVsxHarvesterInternals = {
  buildOpenVsxQuery,
  isRecord,
  readExtensionRecords,
  readFiniteNumber,
  readPublisherVerification,
  readString,
  resolveOpenVsxEndpoint,
  tokenize,
  uniqueStrings,
} as const;
