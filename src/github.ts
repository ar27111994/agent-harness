import { join } from "node:path";

import { getRuntimeConfig } from "./config/runtime.js";
import { readJsonFileOrNull, writeJsonFile } from "./files.js";
import { readResponseTextWithLimit } from "./lib/http.js";
import { assertGitHubRepoSnapshot } from "./manifest-validation.js";
import type { SourceDefinition } from "./types.js";

interface GitHubRepoResponse {
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  updated_at: string | null;
  pushed_at: string | null;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  archived: boolean;
  html_url: string;
}

interface GitHubTreeResponse {
  sha: string;
  truncated: boolean;
  tree?: Array<{
    path: string;
    type: string;
    size?: number;
    sha: string;
  }>;
}

interface GitHubReadmeResponse {
  path: string;
  sha: string;
  size: number;
  html_url: string | null;
  download_url: string | null;
}

interface GitHubSourceHealthEntry {
  sourceId: string;
  owner: string;
  repo: string;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  degradedMode: boolean;
  degradedReason: string | null;
  usedCacheLastAttempt: boolean;
  lastError: string | null;
}

interface GitHubSourceHealthState {
  schemaVersion: 1;
  updatedAt: string;
  entries: Record<string, GitHubSourceHealthEntry>;
}

function assertGitHubSourceHealthState(
  value: unknown,
): asserts value is GitHubSourceHealthState {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected source health state to be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error(
      `Expected schemaVersion to be one of [1], received ${String(record.schemaVersion)}`,
    );
  }
  if (typeof record.updatedAt !== "string") {
    throw new Error("Expected updatedAt to be a string");
  }
  if (
    typeof record.entries !== "object" ||
    record.entries === null ||
    Array.isArray(record.entries)
  ) {
    throw new Error("Expected entries to be a non-null object");
  }

  for (const [entryKey, entryValue] of Object.entries(record.entries)) {
    if (
      typeof entryValue !== "object" ||
      entryValue === null ||
      Array.isArray(entryValue)
    ) {
      throw new Error(`Expected entries.${entryKey} to be an object`);
    }
    const entry = entryValue as Record<string, unknown>;

    if (typeof entry.sourceId !== "string") {
      throw new Error(`Expected entries.${entryKey}.sourceId to be a string`);
    }
    if (typeof entry.owner !== "string") {
      throw new Error(`Expected entries.${entryKey}.owner to be a string`);
    }
    if (typeof entry.repo !== "string") {
      throw new Error(`Expected entries.${entryKey}.repo to be a string`);
    }
    if (typeof entry.lastAttemptAt !== "string") {
      throw new Error(
        `Expected entries.${entryKey}.lastAttemptAt to be a string`,
      );
    }
    if (
      entry.lastSuccessAt !== null &&
      typeof entry.lastSuccessAt !== "string"
    ) {
      throw new Error(
        `Expected entries.${entryKey}.lastSuccessAt to be a string or null`,
      );
    }
    if (
      entry.lastFailureAt !== null &&
      typeof entry.lastFailureAt !== "string"
    ) {
      throw new Error(
        `Expected entries.${entryKey}.lastFailureAt to be a string or null`,
      );
    }
    if (typeof entry.consecutiveFailures !== "number") {
      throw new Error(
        `Expected entries.${entryKey}.consecutiveFailures to be a number`,
      );
    }
    if (typeof entry.degradedMode !== "boolean") {
      throw new Error(
        `Expected entries.${entryKey}.degradedMode to be a boolean`,
      );
    }
    if (
      entry.degradedReason !== null &&
      typeof entry.degradedReason !== "string"
    ) {
      throw new Error(
        `Expected entries.${entryKey}.degradedReason to be a string or null`,
      );
    }
    if (typeof entry.usedCacheLastAttempt !== "boolean") {
      throw new Error(
        `Expected entries.${entryKey}.usedCacheLastAttempt to be a boolean`,
      );
    }
    if (entry.lastError !== null && typeof entry.lastError !== "string") {
      throw new Error(
        `Expected entries.${entryKey}.lastError to be a string or null`,
      );
    }
  }
}

interface GitHubDegradedModeSummary {
  schemaVersion: 1;
  updatedAt: string;
  degradedSources: GitHubSourceHealthEntry[];
}

export interface GitHubRepoSnapshot {
  owner: string;
  repo: string;
  sourceId: string;
  fetchedAt: string;
  repoSummary: {
    name: string;
    fullName: string;
    description: string | null;
    defaultBranch: string;
    updatedAt: string | null;
    pushedAt: string | null;
    stars: number;
    language: string | null;
    topics: string[];
    archived: boolean;
    htmlUrl: string;
  };
  readme: {
    path: string;
    sha: string;
    size: number;
    htmlUrl: string | null;
    downloadUrl: string | null;
  } | null;
  tree: {
    sha: string;
    truncated: boolean;
    entries: Array<{
      path: string;
      type: string;
      size: number | null;
      sha: string;
    }>;
  };
}

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_FETCH_TIMEOUT_MS = 10000;
const GITHUB_JSON_MAX_BYTES = 2_000_000;
const GITHUB_HEALTH_STATE_PATH = [
  "state",
  "remote-cache",
  "github",
  "source-health.json",
];
const GITHUB_DEGRADED_SUMMARY_PATH = [
  "state",
  "remote-cache",
  "github",
  "degraded-summary.json",
];
const GITHUB_REPO_URL_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu;
let githubRateLimitResetAt: number | null = null;
let githubHealthUpdateLock: Promise<void> = Promise.resolve();

/**
 * Clears process-local GitHub throttling and health-update state between CLI
 * invocations that run in the same Node.js process.
 */
export function clearGitHubState(): void {
  githubRateLimitResetAt = null;
  githubHealthUpdateLock = Promise.resolve();
}

export function isGitHubRepoSource(source: SourceDefinition): boolean {
  const repoUrl = source.endpoints.repo;
  return (
    source.kind === "repo" &&
    typeof repoUrl === "string" &&
    GITHUB_REPO_URL_PATTERN.test(repoUrl)
  );
}

export function parseGitHubRepoCoordinates(repoUrl: string): {
  owner: string;
  repo: string;
} | null {
  const match = GITHUB_REPO_URL_PATTERN.exec(repoUrl);

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

export async function fetchGitHubRepoSnapshot(
  source: SourceDefinition,
  projectRoot: string,
): Promise<GitHubRepoSnapshot | null> {
  const repoUrl = source.endpoints.repo;
  if (!repoUrl) {
    return null;
  }

  const coordinates = parseGitHubRepoCoordinates(repoUrl);
  if (!coordinates) {
    return null;
  }

  const { owner, repo } = coordinates;
  return fetchGitHubRepoSnapshotFromCoordinates({
    owner,
    repo,
    projectRoot,
    sourceId: source.id,
  });
}

export async function fetchGitHubRepoSnapshotByRepoUrl(options: {
  repoUrl: string;
  projectRoot: string;
  sourceId: string;
}): Promise<GitHubRepoSnapshot | null> {
  const coordinates = parseGitHubRepoCoordinates(options.repoUrl);
  if (!coordinates) {
    return null;
  }

  return fetchGitHubRepoSnapshotFromCoordinates({
    owner: coordinates.owner,
    repo: coordinates.repo,
    projectRoot: options.projectRoot,
    sourceId: options.sourceId,
  });
}

export function buildGitHubRawFileUrl(options: {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}): string {
  return `https://raw.githubusercontent.com/${options.owner}/${options.repo}/${options.branch}/${options.filePath}`;
}

async function fetchGitHubRepoSnapshotFromCoordinates(options: {
  owner: string;
  repo: string;
  projectRoot: string;
  sourceId: string;
}): Promise<GitHubRepoSnapshot | null> {
  const { owner, repo, projectRoot, sourceId } = options;
  const cachePath = join(
    projectRoot,
    "state",
    "remote-cache",
    "github",
    `${owner}__${repo}.json`,
  );
  const healthKey = `${sourceId}:${owner}/${repo}`;

  if (isRateLimited()) {
    const cachedSnapshot = await readGitHubRepoSnapshotCache(cachePath);
    await updateGitHubSourceHealth(projectRoot, healthKey, {
      sourceId,
      owner,
      repo,
      lastAttemptAt: new Date().toISOString(),
      degradedMode: cachedSnapshot !== null,
      degradedReason: cachedSnapshot
        ? "rate-limited-cache-fallback"
        : "rate-limited-no-cache",
      usedCacheLastAttempt: cachedSnapshot !== null,
      lastError: cachedSnapshot ? null : buildRateLimitMessage(),
      consecutiveFailures: cachedSnapshot ? 0 : 1,
      lastFailureAt: cachedSnapshot ? null : new Date().toISOString(),
    });
    return cachedSnapshot;
  }

  try {
    const repoResponse = await fetchGitHubJsonOptional<GitHubRepoResponse>(
      `/repos/${owner}/${repo}`,
    );
    if (!repoResponse) {
      await updateGitHubSourceHealth(projectRoot, healthKey, {
        sourceId,
        owner,
        repo,
        lastAttemptAt: new Date().toISOString(),
        lastFailureAt: new Date().toISOString(),
        degradedMode: false,
        degradedReason: "repo-not-found",
        usedCacheLastAttempt: false,
        lastError: "Repository not found (404)",
      });
      return null;
    }
    const treeResponse = await fetchGitHubJson<GitHubTreeResponse>(
      `/repos/${owner}/${repo}/git/trees/${repoResponse.default_branch}?recursive=1`,
    );
    const readmeResponse = await fetchGitHubJsonOptional<GitHubReadmeResponse>(
      `/repos/${owner}/${repo}/readme`,
    );

    const snapshot: GitHubRepoSnapshot = {
      owner,
      repo,
      sourceId,
      fetchedAt: new Date().toISOString(),
      repoSummary: {
        name: repoResponse.name,
        fullName: repoResponse.full_name,
        description: repoResponse.description,
        defaultBranch: repoResponse.default_branch,
        updatedAt: repoResponse.updated_at,
        pushedAt: repoResponse.pushed_at,
        stars: repoResponse.stargazers_count,
        language: repoResponse.language,
        topics: repoResponse.topics ?? [],
        archived: repoResponse.archived,
        htmlUrl: repoResponse.html_url,
      },
      readme: readmeResponse
        ? {
            path: readmeResponse.path,
            sha: readmeResponse.sha,
            size: readmeResponse.size,
            htmlUrl: readmeResponse.html_url,
            downloadUrl: readmeResponse.download_url,
          }
        : null,
      tree: {
        sha: treeResponse.sha,
        truncated: treeResponse.truncated,
        entries: (treeResponse.tree ?? []).map((entry) => ({
          path: entry.path,
          type: entry.type,
          size: entry.size ?? null,
          sha: entry.sha,
        })),
      },
    };

    await writeJsonFile(cachePath, snapshot);
    await updateGitHubSourceHealth(projectRoot, healthKey, {
      sourceId,
      owner,
      repo,
      lastAttemptAt: snapshot.fetchedAt,
      lastSuccessAt: snapshot.fetchedAt,
      lastFailureAt: null,
      consecutiveFailures: 0,
      degradedMode: false,
      degradedReason: null,
      usedCacheLastAttempt: false,
      lastError: null,
    });

    return snapshot;
  } catch (error) {
    const cachedSnapshot = await readGitHubRepoSnapshotCache(cachePath);
    if (cachedSnapshot) {
      await updateGitHubSourceHealth(projectRoot, healthKey, {
        sourceId,
        owner,
        repo,
        lastAttemptAt: new Date().toISOString(),
        lastFailureAt: new Date().toISOString(),
        degradedMode: true,
        degradedReason: "fetch-failed-cache-fallback",
        usedCacheLastAttempt: true,
        lastError: getErrorMessage(error),
      });
      return cachedSnapshot;
    }

    await updateGitHubSourceHealth(projectRoot, healthKey, {
      sourceId,
      owner,
      repo,
      lastAttemptAt: new Date().toISOString(),
      lastFailureAt: new Date().toISOString(),
      degradedMode: false,
      degradedReason: null,
      usedCacheLastAttempt: false,
      lastError: getErrorMessage(error),
    });

    throw error;
  }
}

async function fetchGitHubJson<T>(path: string): Promise<T> {
  const response = await fetchGitHubResponse(path);

  if (!response.ok) {
    captureRateLimit(response);
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}) for ${path}`,
    );
  }

  return parseGitHubJsonResponse<T>(response, path);
}

async function fetchGitHubJsonOptional<T>(path: string): Promise<T | null> {
  const response = await fetchGitHubResponse(path);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    captureRateLimit(response);
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}) for ${path}`,
    );
  }

  return parseGitHubJsonResponse<T>(response, path);
}

async function parseGitHubJsonResponse<T>(
  response: Response,
  path: string,
): Promise<T> {
  try {
    return JSON.parse(
      await readResponseTextWithLimit(response, GITHUB_JSON_MAX_BYTES),
    ) as T;
  } catch (error) {
    throw new Error(
      `GitHub API response could not be parsed for ${path}: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}

async function fetchGitHubResponse(path: string): Promise<Response> {
  let lastError: unknown = null;

  const maxAttempts = getRuntimeConfig().github.fetchMaxAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GITHUB_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
        headers: buildGitHubHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 404 || response.ok) {
        return response;
      }

      captureRateLimit(response);

      if (!shouldRetryResponse(response) || attempt === maxAttempts) {
        return response;
      }

      await response.body?.cancel();
      await waitForRetry(attempt, response);
      continue;
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error(
          `Request timed out after ${GITHUB_FETCH_TIMEOUT_MS}ms`,
        );
      } else if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        lastError = new Error(
          `Request timed out after ${GITHUB_FETCH_TIMEOUT_MS}ms`,
        );
      } else {
        lastError = error;
      }

      if (attempt === maxAttempts) {
        break;
      }

      await waitForRetry(attempt);
    }
  }

  throw new Error(
    `GitHub API request failed after ${maxAttempts} attempts for ${path}: ${getErrorMessage(lastError)}`,
  );
}

function buildGitHubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": getRuntimeConfig().github.apiVersion,
    "User-Agent": "agent-harness",
  };

  const githubToken = getRuntimeConfig().github.token;
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  return headers;
}

function captureRateLimit(response: Response): void {
  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  const resetHeader = response.headers.get("x-ratelimit-reset");

  if (remainingHeader === "0" && resetHeader) {
    const resetAtSeconds = Number(resetHeader);
    if (!Number.isNaN(resetAtSeconds)) {
      githubRateLimitResetAt = resetAtSeconds * 1000;
    }
  }
}

function isRateLimited(): boolean {
  if (githubRateLimitResetAt === null) {
    return false;
  }

  if (Date.now() >= githubRateLimitResetAt) {
    githubRateLimitResetAt = null;
    return false;
  }

  return true;
}

async function updateGitHubSourceHealth(
  projectRoot: string,
  key: string,
  nextEntry: Partial<GitHubSourceHealthEntry> &
    Pick<
      GitHubSourceHealthEntry,
      "sourceId" | "owner" | "repo" | "lastAttemptAt"
    >,
): Promise<void> {
  const updateTask = githubHealthUpdateLock.then(async () => {
    const statePath = join(projectRoot, ...GITHUB_HEALTH_STATE_PATH);
    let currentState = await readJsonFileOrNull<GitHubSourceHealthState>(
      statePath,
    ).catch(() => null);

    if (currentState !== null) {
      try {
        assertGitHubSourceHealthState(currentState);
      } catch {
        currentState = null;
      }
    }

    if (currentState === null) {
      currentState = {
        schemaVersion: 1 as const,
        updatedAt: new Date(0).toISOString(),
        entries: {},
      };
    }

    const previousEntry = currentState.entries[key];
    const mergedEntry: GitHubSourceHealthEntry = {
      sourceId: nextEntry.sourceId,
      owner: nextEntry.owner,
      repo: nextEntry.repo,
      lastAttemptAt: nextEntry.lastAttemptAt,
      lastSuccessAt:
        nextEntry.lastSuccessAt ?? previousEntry?.lastSuccessAt ?? null,
      lastFailureAt: Object.prototype.hasOwnProperty.call(
        nextEntry,
        "lastFailureAt",
      )
        ? (nextEntry.lastFailureAt ?? null)
        : (previousEntry?.lastFailureAt ?? null),
      consecutiveFailures:
        nextEntry.consecutiveFailures ??
        (nextEntry.lastFailureAt
          ? (previousEntry?.consecutiveFailures ?? 0) + 1
          : 0),
      degradedMode:
        nextEntry.degradedMode ?? previousEntry?.degradedMode ?? false,
      degradedReason: Object.prototype.hasOwnProperty.call(
        nextEntry,
        "degradedReason",
      )
        ? (nextEntry.degradedReason ?? null)
        : (previousEntry?.degradedReason ?? null),
      usedCacheLastAttempt: nextEntry.usedCacheLastAttempt ?? false,
      lastError: Object.prototype.hasOwnProperty.call(nextEntry, "lastError")
        ? (nextEntry.lastError ?? null)
        : (previousEntry?.lastError ?? null),
    };

    const nextState: GitHubSourceHealthState = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      entries: {
        ...currentState.entries,
        [key]: mergedEntry,
      },
    };

    await writeJsonFile(statePath, nextState);

    const degradedSummary: GitHubDegradedModeSummary = {
      schemaVersion: 1,
      updatedAt: nextState.updatedAt,
      degradedSources: Object.values(nextState.entries)
        .filter((entry) => entry.degradedMode)
        .sort((left, right) =>
          `${left.owner}/${left.repo}`.localeCompare(
            `${right.owner}/${right.repo}`,
          ),
        ),
    };

    await writeJsonFile(
      join(projectRoot, ...GITHUB_DEGRADED_SUMMARY_PATH),
      degradedSummary,
    );
  });

  githubHealthUpdateLock = updateTask.catch(() => undefined);
  await updateTask;
}

async function readGitHubRepoSnapshotCache(
  cachePath: string,
): Promise<GitHubRepoSnapshot | null> {
  try {
    return await readJsonFileOrNull<GitHubRepoSnapshot>(
      cachePath,
      assertGitHubRepoSnapshot,
    );
  } catch {
    return null;
  }
}

function shouldRetryResponse(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

async function waitForRetry(
  attempt: number,
  response?: Response,
): Promise<void> {
  const retryAfterHeader = response?.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader
    ? Number(retryAfterHeader)
    : Number.NaN;
  const retryAfterDelay = Number.isNaN(retryAfterSeconds)
    ? 0
    : retryAfterSeconds * 1000;
  const exponentialDelay = Math.min(5_000, 250 * 2 ** (attempt - 1));
  const jitterDelay = Math.floor(Math.random() * 200);
  const delayMs = Math.max(retryAfterDelay, exponentialDelay + jitterDelay);

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function buildRateLimitMessage(): string {
  if (githubRateLimitResetAt === null) {
    return "GitHub API rate limit is currently active";
  }

  return `GitHub API rate limit active until ${new Date(githubRateLimitResetAt).toISOString()}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
