import { fetchJsonWithGuards } from "./lib/http.js";

const NPM_REGISTRY_ORIGINS = ["https://registry.npmjs.org"] as const;
const PYPI_REGISTRY_ORIGINS = ["https://pypi.org"] as const;
const REGISTRY_METADATA_MAX_BYTES = 2_000_000;
const REGISTRY_FETCH_TIMEOUT_MS = 5_000;

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
}

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
}

export async function fetchNpmPackageMetadata(
  packageName: string,
): Promise<NpmPackageMetadata | null> {
  try {
    const data = await fetchJsonWithGuards(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      {
        allowedOrigins: NPM_REGISTRY_ORIGINS,
        maxBytes: REGISTRY_METADATA_MAX_BYTES,
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

export async function fetchPypiPackageMetadata(
  packageName: string,
): Promise<PypiPackageMetadata | null> {
  try {
    const data = await fetchJsonWithGuards(
      `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
      {
        allowedOrigins: PYPI_REGISTRY_ORIGINS,
        maxBytes: REGISTRY_METADATA_MAX_BYTES,
        timeoutMs: REGISTRY_FETCH_TIMEOUT_MS,
      },
    );
    return normalizePypiPackageMetadata(data, packageName);
  } catch {
    return null;
  }
}

function normalizeNpmPackageMetadata(
  data: Record<string, unknown>,
  packageName: string,
): NpmPackageMetadata {
  return {
    name: typeof data.name === "string" ? data.name : packageName,
    description:
      typeof data.description === "string" ? data.description : undefined,
    homepage: typeof data.homepage === "string" ? data.homepage : undefined,
    repository: normalizeNpmRepository(data.repository),
    distTags: normalizeStringRecord(data["dist-tags"]),
    keywords: Array.isArray(data.keywords)
      ? data.keywords.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    versions: isRecord(data.versions) ? data.versions : undefined,
  };
}

function normalizeNpmRepository(
  value: unknown,
): NpmPackageMetadata["repository"] {
  if (typeof value === "string") {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return {
    type: typeof value.type === "string" ? value.type : undefined,
    url: typeof value.url === "string" ? value.url : undefined,
  };
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
  };
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

export function extractRepositoryUrlFromNpmMetadata(
  metadata: NpmPackageMetadata,
): string | undefined {
  if (!metadata.repository) {
    return undefined;
  }

  if (typeof metadata.repository === "string") {
    return sanitizeRepositoryUrl(metadata.repository);
  }

  return metadata.repository.url
    ? sanitizeRepositoryUrl(metadata.repository.url)
    : undefined;
}

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
  return value
    .replace(/^git\+/u, "")
    .replace(/\.git$/u, "")
    .replace(/^git:/u, "https:");
}
