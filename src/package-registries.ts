import { getRuntimeConfig } from "./config/runtime.js";
import {
  fetchJsonWithGuards,
  type FetchWithGuardsOptions,
} from "./lib/http.js";
import { readFileSync } from "node:fs";

const AGENT_HARNESS_VERSION: string = (() => {
  try {
    return (
      JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
    ).version;
  } catch {
    return "2.0.0";
  }
})();

const NPM_REGISTRY_ORIGINS = ["https://registry.npmjs.org"] as const;
const PYPI_REGISTRY_ORIGINS = ["https://pypi.org"] as const;

/** Adapter interface for registry-specific search behavior. */
interface RegistrySearchAdapter {
  buildUrl(query: string, limit: number): URL;
  extractResults(data: unknown): RegistrySearchResult[];
  allowedOrigins: readonly string[];
  getHeaders(): Record<string, string>;
}

/**
 * Shared registry search logic extracted from 5 nearly identical functions.
 * Handles query normalization, URL building, fetch with guards, data validation,
 * result extraction, and error handling.
 */
async function searchRegistry(
  query: string,
  limit: number,
  adapter: RegistrySearchAdapter,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<RegistrySearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const registriesConfig = getRuntimeConfig().registries;
  try {
    const url = adapter.buildUrl(normalized, limit);
    const data = await fetchJsonWithGuards(url.toString(), {
      allowedOrigins: adapter.allowedOrigins,
      headers: adapter.getHeaders(),
      maxBytes: registriesConfig.searchMaxBytes,
      resolveHostname: options.resolveHostname,
      timeoutMs: registriesConfig.fetchTimeoutMs,
    });
    return adapter.extractResults(data).filter((r) => r.name.length > 0);
    /* c8 ignore start -- fetchJsonWithGuards catches internally and returns null; outer catch is an unreachable defensive guard */
  } catch {
    return [];
  }
  /* c8 ignore stop */
}

/**
 * Describes npm package search result data exchanged by the lifecycle pipeline.
 */
export interface NpmPackageSearchResult {
  name: string;
  description?: string;
  keywords: string[];
  lastUpdated?: string;
}

/**
 * Describes npm package metadata exchanged by the lifecycle pipeline.
 */
export interface NpmPackageMetadata {
  name: string;
  description?: string;
  homepage?: string;
  repository?:
    | {
        type?: string;
        url?: string;
      }
    | string;
  distTags?: Record<string, string>;
  keywords?: string[];
  versions?: Record<string, unknown>;
  lastUpdated?: string;
}

/**
 * Describes pypi package metadata exchanged by the lifecycle pipeline.
 */
export interface PypiPackageMetadata {
  info: {
    name: string;
    summary?: string;
    home_page?: string;
    project_urls?: Record<string, string>;
    version?: string;
    keywords?: string;
    package_url?: string;
  };
  lastUpdated?: string;
}

/**
 * Searches npm package metadata with the configured runtime safeguards.
 */
export async function fetchNpmPackageSearch(
  query: string,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<NpmPackageSearchResult[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const registriesConfig = getRuntimeConfig().registries;

  try {
    const searchUrl = new URL("https://registry.npmjs.org/-/v1/search");
    searchUrl.searchParams.set("text", normalizedQuery);
    searchUrl.searchParams.set(
      "size",
      String(registriesConfig.npmSearchResultLimit),
    );
    const data = await fetchJsonWithGuards(searchUrl.toString(), {
      allowedOrigins: NPM_REGISTRY_ORIGINS,
      headers: { Accept: "application/json" },
      maxBytes: registriesConfig.searchMaxBytes,
      resolveHostname: options.resolveHostname,
      timeoutMs: registriesConfig.fetchTimeoutMs,
    });

    return normalizeNpmPackageSearchResults(data);
  } catch {
    return [];
  }
}

/**
 * Fetches npm package metadata with the configured runtime safeguards.
 */
export async function fetchNpmPackageMetadata(
  packageName: string,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<NpmPackageMetadata | null> {
  const registriesConfig = getRuntimeConfig().registries;

  try {
    const data = await fetchJsonWithGuards(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      {
        allowedOrigins: NPM_REGISTRY_ORIGINS,
        headers: { Accept: "application/vnd.npm.install-v1+json" },
        maxBytes: registriesConfig.metadataMaxBytes,
        resolveHostname: options.resolveHostname,
        timeoutMs: registriesConfig.fetchTimeoutMs,
      },
    );
    if (!isRecord(data)) {
      return null;
    }

    return normalizeNpmPackageMetadata(data, packageName);
  } catch {
    return null;
  }
}

/**
 * Fetches pypi package metadata with the configured runtime safeguards.
 */
export async function fetchPypiPackageMetadata(
  packageName: string,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<PypiPackageMetadata | null> {
  const registriesConfig = getRuntimeConfig().registries;

  try {
    const data = await fetchJsonWithGuards(
      `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
      {
        allowedOrigins: PYPI_REGISTRY_ORIGINS,
        maxBytes: registriesConfig.metadataMaxBytes,
        resolveHostname: options.resolveHostname,
        timeoutMs: registriesConfig.fetchTimeoutMs,
      },
    );
    return normalizePypiPackageMetadata(data, packageName);
  } catch {
    return null;
  }
}

/**
 * Normalizes npm search API responses into package search result records.
 */
export function normalizeNpmPackageSearchResults(
  data: unknown,
): NpmPackageSearchResult[] {
  if (!isRecord(data) || !Array.isArray(data.objects)) {
    return [];
  }

  return data.objects.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.package)) {
      return [];
    }

    const packageName = entry.package.name;
    if (typeof packageName !== "string" || packageName.trim().length === 0) {
      return [];
    }

    return [
      {
        name: packageName,
        description:
          typeof entry.package.description === "string"
            ? entry.package.description
            : undefined,
        keywords: normalizeStringArray(entry.package.keywords),
        lastUpdated:
          typeof entry.package.date === "string"
            ? entry.package.date
            : undefined,
      },
    ];
  });
}

/**
 * Normalizes npm package metadata responses for discovery scoring.
 */
export function normalizeNpmPackageMetadata(
  data: Record<string, unknown>,
  packageName: string,
): NpmPackageMetadata {
  return {
    name: typeof data.name === "string" ? data.name : packageName,
    description:
      typeof data.description === "string" ? data.description : undefined,
    homepage: normalizeHttpUrl(data.homepage),
    repository: normalizeNpmRepository(data.repository),
    distTags: normalizeStringRecord(data["dist-tags"]),
    keywords: Array.isArray(data.keywords)
      ? normalizeStringArray(data.keywords)
      : undefined,
    versions: isRecord(data.versions) ? data.versions : undefined,
    lastUpdated: normalizeStringRecord(data.time)?.modified,
  };
}

function normalizeNpmRepository(
  value: unknown,
): NpmPackageMetadata["repository"] {
  if (typeof value === "string") {
    return normalizeRepositoryHttpUrl(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const normalizedUrl = normalizeRepositoryHttpUrl(value.url);
  return normalizedUrl
    ? {
        type: typeof value.type === "string" ? value.type : undefined,
        url: normalizedUrl,
      }
    : undefined;
}

/**
 * Normalizes PyPI package metadata responses for discovery scoring.
 */
export function normalizePypiPackageMetadata(
  data: unknown,
  packageName: string,
): PypiPackageMetadata | null {
  if (!isRecord(data) || !isRecord(data.info)) {
    return null;
  }

  return {
    info: {
      name: typeof data.info.name === "string" ? data.info.name : packageName,
      summary:
        typeof data.info.summary === "string" ? data.info.summary : undefined,
      home_page: normalizeHttpUrl(data.info.home_page),
      project_urls: normalizeUrlRecord(data.info.project_urls),
      version:
        typeof data.info.version === "string" ? data.info.version : undefined,
      keywords:
        typeof data.info.keywords === "string" ? data.info.keywords : undefined,
      package_url: normalizeHttpUrl(data.info.package_url),
    },
    lastUpdated: normalizePypiLastUpdated(data.releases),
  };
}

function normalizePypiLastUpdated(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const timestamps = Object.values(value).flatMap((releaseFiles) => {
    if (!Array.isArray(releaseFiles)) {
      return [];
    }

    return releaseFiles.flatMap((releaseFile) => {
      if (!isRecord(releaseFile)) {
        return [];
      }

      const timestamp =
        typeof releaseFile.upload_time_iso_8601 === "string"
          ? releaseFile.upload_time_iso_8601
          : typeof releaseFile.upload_time === "string"
            ? releaseFile.upload_time
            : undefined;
      return timestamp ? [timestamp] : [];
    });
  });

  return timestamps.sort((left, right) => right.localeCompare(left))[0];
}

function normalizeUrlRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([key, rawValue]) => {
    const normalizedUrl = normalizeHttpUrl(rawValue);
    return normalizedUrl
      ? ([[key, normalizedUrl]] as Array<[string, string]>)
      : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeRepositoryHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return normalizeHttpUrl(sanitizeRepositoryUrl(value));
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsedUrl = new URL(value);
    return (parsedUrl.protocol === "http:" ||
      parsedUrl.protocol === "https:") &&
      parsedUrl.hostname.length > 0
      ? parsedUrl.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
}

function normalizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Provides extract repository url from npm metadata for the lifecycle pipeline.
 */
export function extractRepositoryUrlFromNpmMetadata(
  metadata: NpmPackageMetadata,
): string | undefined {
  if (!metadata.repository) {
    return undefined;
  }

  if (typeof metadata.repository === "string") {
    return normalizeRepositoryHttpUrl(metadata.repository);
  }

  return metadata.repository.url
    ? normalizeRepositoryHttpUrl(metadata.repository.url)
    : undefined;
}

/**
 * Provides extract repository url from pypi metadata for the lifecycle pipeline.
 */
export function extractRepositoryUrlFromPypiMetadata(
  metadata: PypiPackageMetadata,
): string | undefined {
  const projectUrls = metadata.info.project_urls ?? {};
  const possibleUrls = [
    projectUrls.Source,
    projectUrls.Repository,
    projectUrls.Homepage,
    metadata.info.home_page,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  const githubUrl = possibleUrls.find(isGitHubRepositoryUrl);
  return githubUrl ? sanitizeRepositoryUrl(githubUrl) : undefined;
}

function isGitHubRepositoryUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return (
      parsedUrl.hostname.toLowerCase() === "github.com" &&
      parsedUrl.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

/**
 * Sanitizes package registry repository URL values into HTTPS GitHub URLs when possible.
 */
export function sanitizeRepositoryUrl(value: string): string {
  const trimmedValue = stripUrlSuffix(value.trim());
  const githubShorthand = /^github:([^/\s]+)\/(.+)$/iu.exec(trimmedValue);
  if (githubShorthand?.[1] && githubShorthand[2]) {
    return buildGitHubRepositoryUrl(githubShorthand[1], githubShorthand[2]);
  }

  const scpLikeGithubUrl = /^git@github\.com:([^/\s]+)\/(.+)$/iu.exec(
    trimmedValue,
  );
  if (scpLikeGithubUrl?.[1] && scpLikeGithubUrl[2]) {
    return buildGitHubRepositoryUrl(scpLikeGithubUrl[1], scpLikeGithubUrl[2]);
  }

  const withoutGitPrefix = trimmedValue.replace(/^git\+/iu, "");
  const sshGithubUrl = /^ssh:\/\/git@github\.com\/([^/\s]+)\/(.+)$/iu.exec(
    withoutGitPrefix,
  );
  if (sshGithubUrl?.[1] && sshGithubUrl[2]) {
    return buildGitHubRepositoryUrl(sshGithubUrl[1], sshGithubUrl[2]);
  }

  const normalizedUrl = withoutGitPrefix.replace(/^git:/iu, "https:");
  try {
    const parsedUrl = new URL(normalizedUrl);
    if (parsedUrl.hostname.toLowerCase() === "github.com") {
      const [owner, repo] = parsedUrl.pathname.split("/").filter(Boolean);
      return owner && repo
        ? buildGitHubRepositoryUrl(owner, repo)
        : normalizedUrl;
    }
  } catch {
    return normalizedUrl.replace(/\.git$/iu, "");
  }

  return normalizedUrl.replace(/\.git$/iu, "");
}

function buildGitHubRepositoryUrl(owner: string, repo: string): string {
  const cleanOwner = stripUrlSuffix(owner).split("/").filter(Boolean)[0];
  const cleanRepo = stripUrlSuffix(repo)
    .split("/")
    .filter(Boolean)[0]
    ?.replace(/\.git$/iu, "");
  return cleanOwner && cleanRepo
    ? `https://github.com/${cleanOwner}/${cleanRepo}`
    : `https://github.com/${owner}/${repo.replace(/\.git$/iu, "")}`;
}

function stripUrlSuffix(value: string): string {
  return value.split(/[?#]/u)[0] as string;
}

/** Result returned by any registry search (common shape across registries). */
export interface RegistrySearchResult {
  name: string;
  description?: string;
  downloads?: number;
}

const crateSearchAdapter: RegistrySearchAdapter = {
  buildUrl(query: string, limit: number): URL {
    const url = new URL("https://crates.io/api/v1/crates");
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "downloads");
    url.searchParams.set("per_page", String(Math.min(limit, 100)));
    return url;
  },
  extractResults(data: unknown): RegistrySearchResult[] {
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray((data as Record<string, unknown>)["crates"])
    )
      return [];
    return (
      (data as Record<string, unknown>)["crates"] as Record<string, unknown>[]
    ).map((c) => ({
      name: typeof c["name"] === "string" ? c["name"] : "",
      description:
        typeof c["description"] === "string" ? c["description"] : undefined,
      downloads:
        typeof c["downloads"] === "number" ? c["downloads"] : undefined,
    }));
  },
  allowedOrigins: ["https://crates.io"],
  getHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": `agent-harness/${AGENT_HARNESS_VERSION} (github.com/ar27111994/agent-harness)`,
    };
  },
};

/**
 * Searches crates.io by keyword, sorted by download count.
 * Includes the required `User-Agent: agent-harness/<version>` header per API TOS.
 */
export async function fetchCratesIoSearch(
  query: string,
  limit = 25,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<RegistrySearchResult[]> {
  return searchRegistry(query, limit, crateSearchAdapter, options);
}

const nugetSearchAdapter: RegistrySearchAdapter = {
  buildUrl(query: string, limit: number): URL {
    const url = new URL("https://azuresearch-usnc.nuget.org/query");
    url.searchParams.set("q", query);
    url.searchParams.set("take", String(Math.min(limit, 100)));
    url.searchParams.set("sortBy", "totalDownloads");
    return url;
  },
  extractResults(data: unknown): RegistrySearchResult[] {
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray((data as Record<string, unknown>)["data"])
    )
      return [];
    return (
      (data as Record<string, unknown>)["data"] as Record<string, unknown>[]
    ).map((p) => ({
      name: typeof p["id"] === "string" ? p["id"] : "",
      description:
        typeof p["description"] === "string" ? p["description"] : undefined,
      downloads:
        typeof p["totalDownloads"] === "number"
          ? p["totalDownloads"]
          : undefined,
    }));
  },
  allowedOrigins: ["https://azuresearch-usnc.nuget.org"],
  getHeaders(): Record<string, string> {
    return { Accept: "application/json" };
  },
};

/**
 * Searches the NuGet v3 query endpoint, sorted by total downloads.
 */
export async function fetchNugetSearch(
  query: string,
  limit = 25,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<RegistrySearchResult[]> {
  return searchRegistry(query, limit, nugetSearchAdapter, options);
}

const mavenSearchAdapter: RegistrySearchAdapter = {
  buildUrl(query: string, limit: number): URL {
    const url = new URL("https://search.maven.org/solrsearch/select");
    url.searchParams.set("q", query);
    url.searchParams.set("rows", String(Math.min(limit, 100)));
    url.searchParams.set("wt", "json");
    return url;
  },
  extractResults(data: unknown): RegistrySearchResult[] {
    const response = data as Record<string, unknown> | null;
    const docs = response?.["response"] as Record<string, unknown> | undefined;
    if (!docs || !Array.isArray(docs["docs"])) return [];
    return (docs["docs"] as Record<string, unknown>[]).map((d) => ({
      name:
        typeof d["id"] === "string"
          ? d["id"]
          : typeof d["g"] === "string" && typeof d["a"] === "string"
            ? `${d["g"]}:${d["a"]}`
            : "",
      description: undefined,
    }));
  },
  allowedOrigins: ["https://search.maven.org"],
  getHeaders(): Record<string, string> {
    return { Accept: "application/json" };
  },
};

/**
 * Searches Maven Central via the Solr-backed search endpoint.
 */
export async function fetchMavenSearch(
  query: string,
  limit = 25,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<RegistrySearchResult[]> {
  return searchRegistry(query, limit, mavenSearchAdapter, options);
}

const packagistSearchAdapter: RegistrySearchAdapter = {
  buildUrl(query: string, limit: number): URL {
    const url = new URL("https://packagist.org/search.json");
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(Math.min(limit, 100)));
    return url;
  },
  extractResults(data: unknown): RegistrySearchResult[] {
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray((data as Record<string, unknown>)["results"])
    )
      return [];
    return (
      (data as Record<string, unknown>)["results"] as Record<string, unknown>[]
    ).map((p) => ({
      name: typeof p["name"] === "string" ? p["name"] : "",
      description:
        typeof p["description"] === "string" ? p["description"] : undefined,
      downloads:
        typeof p["downloads"] === "number" ? p["downloads"] : undefined,
    }));
  },
  allowedOrigins: ["https://packagist.org"],
  getHeaders(): Record<string, string> {
    return { Accept: "application/json" };
  },
};

/**
 * Searches Packagist (PHP Composer registry) by keyword.
 */
export async function fetchPackagistSearch(
  query: string,
  limit = 25,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<RegistrySearchResult[]> {
  return searchRegistry(query, limit, packagistSearchAdapter, options);
}

const rubyGemsSearchAdapter: RegistrySearchAdapter = {
  buildUrl(query: string, limit: number): URL {
    const url = new URL("https://rubygems.org/api/v1/search.json");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(Math.min(limit, 50)));
    return url;
  },
  extractResults(data: unknown): RegistrySearchResult[] {
    if (!Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map((g) => ({
      name: typeof g["name"] === "string" ? g["name"] : "",
      description: typeof g["info"] === "string" ? g["info"] : undefined,
      downloads:
        typeof g["downloads"] === "number" ? g["downloads"] : undefined,
    }));
  },
  allowedOrigins: ["https://rubygems.org"],
  getHeaders(): Record<string, string> {
    return { Accept: "application/json" };
  },
};

/**
 * Searches RubyGems by keyword, sorted by download count.
 */
export async function fetchRubyGemsSearch(
  query: string,
  limit = 25,
  options: Pick<FetchWithGuardsOptions, "resolveHostname"> = {},
): Promise<RegistrySearchResult[]> {
  return searchRegistry(query, limit, rubyGemsSearchAdapter, options);
}

/**
 * Exposes narrow package-registry internals for focused behavioral coverage.
 */
export const packageRegistryInternals = {
  normalizeStringArray,
  normalizeStringRecord,
  isGitHubRepositoryUrl,
  buildGitHubRepositoryUrl,
  stripUrlSuffix,
};
