import {
  fetchJsonWithGuards,
  type FetchWithGuardsOptions,
} from "./lib/http.js";

const NPM_REGISTRY_ORIGINS = ["https://registry.npmjs.org"] as const;
const PYPI_REGISTRY_ORIGINS = ["https://pypi.org"] as const;
const REGISTRY_METADATA_MAX_BYTES = 2_000_000;
const REGISTRY_SEARCH_MAX_BYTES = 500_000;
const REGISTRY_FETCH_TIMEOUT_MS = 5_000;
const NPM_SEARCH_RESULT_LIMIT = 12;

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

  try {
    const searchUrl = new URL("https://registry.npmjs.org/-/v1/search");
    searchUrl.searchParams.set("text", normalizedQuery);
    searchUrl.searchParams.set("size", String(NPM_SEARCH_RESULT_LIMIT));
    const data = await fetchJsonWithGuards(searchUrl.toString(), {
      allowedOrigins: NPM_REGISTRY_ORIGINS,
      headers: { Accept: "application/json" },
      maxBytes: REGISTRY_SEARCH_MAX_BYTES,
      resolveHostname: options.resolveHostname,
      timeoutMs: REGISTRY_FETCH_TIMEOUT_MS,
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
  try {
    const data = await fetchJsonWithGuards(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      {
        allowedOrigins: NPM_REGISTRY_ORIGINS,
        headers: { Accept: "application/vnd.npm.install-v1+json" },
        maxBytes: REGISTRY_METADATA_MAX_BYTES,
        resolveHostname: options.resolveHostname,
        timeoutMs: REGISTRY_FETCH_TIMEOUT_MS,
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
  try {
    const data = await fetchJsonWithGuards(
      `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
      {
        allowedOrigins: PYPI_REGISTRY_ORIGINS,
        maxBytes: REGISTRY_METADATA_MAX_BYTES,
        resolveHostname: options.resolveHostname,
        timeoutMs: REGISTRY_FETCH_TIMEOUT_MS,
      },
    );
    return normalizePypiPackageMetadata(data, packageName);
  } catch {
    return null;
  }
}

function normalizeNpmPackageSearchResults(
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

function normalizeNpmPackageMetadata(
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
      ? data.keywords.filter(
          (value): value is string => typeof value === "string",
        )
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

function normalizePypiPackageMetadata(
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

function sanitizeRepositoryUrl(value: string): string {
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
  return value.split(/[?#]/u)[0] ?? value;
}
