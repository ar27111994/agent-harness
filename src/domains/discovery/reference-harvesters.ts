import { fetchJsonWithGuards, fetchTextWithGuards } from "../../lib/http.js";
import type {
  AssetKind,
  CompatibilityMode,
  DemandProfile,
  SourceDefinition,
} from "../../types.js";

export interface HarvestedReferenceItem {
  displayName: string;
  originUrl: string;
  summary: string;
  capabilities: string[];
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  installMethod: string;
  manifestEntry?: string;
  stars?: number;
  lastUpdated?: string;
}

const GENERIC_REFERENCE_MAX_ITEMS = 8;
const REFERENCE_SOURCE_MAX_BYTES = 600_000;
const VSCODE_MARKETPLACE_MAX_QUERIES = 4;
const VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY = 6;
const VSCODE_MARKETPLACE_API =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const VSCODE_MARKETPLACE_ORIGINS = [
  "https://marketplace.visualstudio.com",
] as const;

export async function harvestReferenceItems(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
): Promise<HarvestedReferenceItem[]> {
  if (source.kind === "marketplace" && source.id === "vscode-marketplace") {
    return harvestVsCodeMarketplaceItems(source, demandProfile);
  }

  if (source.kind === "docs" || source.kind === "registry") {
    return harvestGenericReferenceItems(source);
  }

  return [];
}

async function harvestGenericReferenceItems(
  source: SourceDefinition,
): Promise<HarvestedReferenceItem[]> {
  const originUrl = getReferenceSourceOriginUrl(source);
  const allowedOrigin = getAllowedOrigin(originUrl);
  if (!allowedOrigin) {
    return [];
  }

  const content = await fetchTextWithGuards(originUrl, {
    allowedOrigins: [allowedOrigin],
    maxBytes: REFERENCE_SOURCE_MAX_BYTES,
  });
  if (content === null) {
    return [];
  }

  const rootItem = buildGenericReferenceItem(source, {
    displayName: extractTitle(content) ?? source.name,
    originUrl,
    summary: summarizeText(content),
  });
  const linkItems = extractReferenceLinks(content, originUrl)
    .slice(0, GENERIC_REFERENCE_MAX_ITEMS - 1)
    .map((link) =>
      buildGenericReferenceItem(source, {
        displayName: link.text,
        originUrl: link.href,
        summary: `${source.name}: ${link.text}`,
      }),
    );

  return dedupeItems([rootItem, ...linkItems]);
}

async function harvestVsCodeMarketplaceItems(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
): Promise<HarvestedReferenceItem[]> {
  const queries = selectDemandQueries(demandProfile);
  const apiUrl = source.endpoints.marketplaceApi ?? VSCODE_MARKETPLACE_API;
  const harvestedItems: HarvestedReferenceItem[] = [];

  for (const query of queries.slice(0, VSCODE_MARKETPLACE_MAX_QUERIES)) {
    const data = await fetchJsonWithGuards(apiUrl, {
      allowedOrigins: VSCODE_MARKETPLACE_ORIGINS,
      body: JSON.stringify(buildVsCodeMarketplaceRequest(query)),
      headers: {
        Accept: "application/json;api-version=7.2-preview.1;excludeUrls=true",
        "Content-Type": "application/json",
      },
      maxBytes: REFERENCE_SOURCE_MAX_BYTES,
      method: "POST",
    });
    harvestedItems.push(
      ...normalizeVsCodeMarketplaceItems(data, query).slice(
        0,
        VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY,
      ),
    );
  }

  return dedupeItems(harvestedItems).slice(
    0,
    VSCODE_MARKETPLACE_MAX_QUERIES * VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY,
  );
}

function buildGenericReferenceItem(
  source: SourceDefinition,
  options: {
    displayName: string;
    originUrl: string;
    summary: string;
  },
): HarvestedReferenceItem {
  return {
    displayName: options.displayName,
    originUrl: options.originUrl,
    summary: options.summary,
    capabilities: [source.kind, ...splitIntoKeywords(options.displayName)],
    assetKind: "reference-pack",
    compatibilityMode: "adaptable",
    installMethod: `${source.kind}-summary`,
    manifestEntry: options.originUrl,
  };
}

function normalizeVsCodeMarketplaceItems(
  data: unknown,
  query: string,
): HarvestedReferenceItem[] {
  if (!isRecord(data)) {
    return [];
  }

  const results = Array.isArray(data.results) ? data.results : [];
  return results.flatMap((result) => {
    if (!isRecord(result) || !Array.isArray(result.extensions)) {
      return [];
    }

    return result.extensions.flatMap((extension) =>
      normalizeVsCodeMarketplaceExtension(extension, query),
    );
  });
}

function normalizeVsCodeMarketplaceExtension(
  value: unknown,
  query: string,
): HarvestedReferenceItem[] {
  if (!isRecord(value)) {
    return [];
  }

  const publisher = isRecord(value.publisher)
    ? (getString(value.publisher.publisherName) ??
      getString(value.publisher.displayName))
    : undefined;
  const extensionName = getString(value.extensionName);
  if (!publisher || !extensionName) {
    return [];
  }

  const extensionId = `${publisher}.${extensionName}`;
  const displayName = getString(value.displayName) ?? extensionId;
  const summary = getString(value.shortDescription) ?? displayName;
  const originUrl =
    getString(value.url) ??
    `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(
      extensionId,
    )}`;

  return [
    {
      displayName,
      originUrl,
      summary,
      capabilities: uniqueStrings([
        "extension",
        "vscode",
        "marketplace",
        query,
        ...splitIntoKeywords(displayName),
        ...splitIntoKeywords(summary),
      ]),
      assetKind: "extension",
      compatibilityMode: "native",
      installMethod: "vscode-extension",
      manifestEntry: extensionId,
      stars: getMarketplaceStatistic(value, "install") ?? 0,
      lastUpdated: getString(value.lastUpdated),
    },
  ];
}

function buildVsCodeMarketplaceRequest(query: string): Record<string, unknown> {
  return {
    assetTypes: ["Microsoft.VisualStudio.Services.VSIXPackage"],
    filters: [
      {
        criteria: [
          { filterType: 8, value: "Microsoft.VisualStudio.Code" },
          { filterType: 10, value: query },
        ],
        direction: 2,
        pageNumber: 1,
        pageSize: VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY,
        sortBy: 0,
        sortOrder: 0,
      },
    ],
    flags: 0x1 | 0x2 | 0x80,
  };
}

function selectDemandQueries(demandProfile: DemandProfile | null): string[] {
  const demandSignals = demandProfile
    ? [
        ...demandProfile.signals.frameworks,
        ...demandProfile.signals.concerns,
        ...demandProfile.signals.tooling,
        ...demandProfile.signals.languages,
      ]
    : [];
  const normalizedSignals = demandSignals
    .map((signal) => signal.replace(/^(npm|pypi|detector):/u, ""))
    .map((signal) => signal.replace(/[^A-Za-z0-9_.-]+/gu, " ").trim())
    .filter((signal) => signal.length >= 2);

  return uniqueStrings([
    ...normalizedSignals,
    "copilot",
    "ai",
    "mcp",
    "testing",
  ]);
}

function extractReferenceLinks(
  content: string,
  baseUrl: string,
): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const allowedOrigin = getAllowedOrigin(baseUrl);
  if (!allowedOrigin) {
    return links;
  }

  for (const match of content.matchAll(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/giu,
  )) {
    const href = normalizeSameOriginUrl(match[1] ?? "", baseUrl, allowedOrigin);
    const text = stripHtml(match[2] ?? "").trim();
    if (href && text.length > 0) {
      links.push({ href, text });
    }
  }

  for (const match of content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)) {
    const href = normalizeSameOriginUrl(match[2] ?? "", baseUrl, allowedOrigin);
    const text = (match[1] ?? "").trim();
    if (href && text.length > 0) {
      links.push({ href, text });
    }
  }

  return dedupeLinks(links);
}

function normalizeSameOriginUrl(
  rawHref: string,
  baseUrl: string,
  allowedOrigin: string,
): string | null {
  try {
    const url = new URL(rawHref, baseUrl);
    if (url.origin.toLowerCase() !== allowedOrigin.toLowerCase()) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function getReferenceSourceOriginUrl(source: SourceDefinition): string {
  return (
    source.endpoints.docsUrl ??
    source.endpoints.baseUrl ??
    source.endpoints.repo ??
    source.id
  );
}

function getAllowedOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function extractTitle(content: string): string | null {
  const htmlTitle = /<title[^>]*>(.*?)<\/title>/iu.exec(content)?.[1];
  if (htmlTitle) {
    return stripHtml(htmlTitle).trim();
  }

  const markdownHeading = /^#\s+(.+)$/mu.exec(content)?.[1];
  return markdownHeading?.trim() ?? null;
}

function summarizeText(content: string): string {
  return stripHtml(content).replace(/\s+/gu, " ").trim().slice(0, 500);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/gu, " ").replace(/&amp;/gu, "&");
}

function getMarketplaceStatistic(
  extension: Record<string, unknown>,
  statisticName: string,
): number | undefined {
  const statistics = Array.isArray(extension.statistics)
    ? extension.statistics
    : [];
  for (const statistic of statistics) {
    if (!isRecord(statistic)) {
      continue;
    }
    if (getString(statistic.statisticName)?.toLowerCase() !== statisticName) {
      continue;
    }
    const value = statistic.value;
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }
  return undefined;
}

function dedupeItems(
  items: HarvestedReferenceItem[],
): HarvestedReferenceItem[] {
  const byUrl = new Map<string, HarvestedReferenceItem>();
  for (const item of items) {
    byUrl.set(item.originUrl, item);
  }
  return [...byUrl.values()].sort((left, right) =>
    left.originUrl.localeCompare(right.originUrl),
  );
}

function dedupeLinks(
  links: Array<{ href: string; text: string }>,
): Array<{ href: string; text: string }> {
  const byHref = new Map<string, { href: string; text: string }>();
  for (const link of links) {
    byHref.set(link.href, link);
  }
  return [...byHref.values()];
}

function splitIntoKeywords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((part) => part.length >= 2);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
