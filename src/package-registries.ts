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

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export async function fetchNpmPackageMetadata(
  packageName: string,
): Promise<NpmPackageMetadata | null> {
  try {
    const response = await fetchWithTimeout(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      {},
      5000,
    );
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      name: typeof data.name === "string" ? data.name : packageName,
      description:
        typeof data.description === "string" ? data.description : undefined,
      homepage: typeof data.homepage === "string" ? data.homepage : undefined,
      repository:
        typeof data.repository === "string" ||
        typeof data.repository === "object"
          ? (data.repository as NpmPackageMetadata["repository"])
          : undefined,
      distTags:
        typeof data["dist-tags"] === "object" && data["dist-tags"] !== null
          ? (data["dist-tags"] as Record<string, string>)
          : undefined,
      keywords: Array.isArray(data.keywords)
        ? data.keywords.filter(
            (value): value is string => typeof value === "string",
          )
        : undefined,
      versions:
        typeof data.versions === "object" && data.versions !== null
          ? (data.versions as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchPypiPackageMetadata(
  packageName: string,
): Promise<PypiPackageMetadata | null> {
  try {
    const response = await fetchWithTimeout(
      `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
      {},
      5000,
    );
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PypiPackageMetadata;
  } catch {
    return null;
  }
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

  const githubUrl = possibleUrls.find((value) => value.includes("github.com/"));
  return githubUrl ? sanitizeRepositoryUrl(githubUrl) : undefined;
}

function sanitizeRepositoryUrl(value: string): string {
  return value
    .replace(/^git\+/u, "")
    .replace(/\.git$/u, "")
    .replace(/^git:/u, "https:");
}
