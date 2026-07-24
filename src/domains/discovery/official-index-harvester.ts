import { join } from "node:path";

import { fetchOfficialIndexPageRepositoryUrl } from "../../official-index.js";
import type {
  AssetCatalogEntry,
  AssetKind,
  CompatibilityMode,
  DemandProfile,
  HostTarget,
  SourceDefinition,
} from "../../types.js";
import { getRuntimeConfig } from "../../config/runtime.js";
import { readJsonFileOrNull, writeJsonFile } from "../../files.js";
import { fetchJsonWithGuards, fetchTextWithGuards } from "../../lib/http.js";
import { buildOfficialIndexAssetStatus } from "../../official-index.js";
import {
  buildCandidateRankHint,
  buildCatalogId,
  buildRisk,
  buildTrustSignals,
  computeHostFit,
  computePortfolioFit,
  computeTrustScore,
  GENERIC_CAPABILITY_TOKENS,
  splitIntoKeywords,
  uniqueStrings,
} from "./catalog-utils.js";
import {
  OFFICIAL_UPSTREAM_CACHE_STATE_PATH,
  OFFICIAL_UPSTREAM_RESOLUTION_OUTPUT_PATH,
} from "./output-paths.js";
import { loadSourceRegistry } from "./source-registry.js";

interface OfficialSkillIndexShape {
  schemaVersion: number;
  indexes: Array<{
    id: string;
    kind: string;
    url: string;
    expectedOwner?: string;
    pinnedRef?: string;
    description?: string;
  }>;
}

interface OfficialUpstreamAllowlistShape {
  schemaVersion: number;
  owners: Record<string, string[]>;
}

interface GitHubSearchResponseShape {
  items?: Array<{
    full_name?: unknown;
    html_url?: unknown;
  }>;
}

interface OfficialUpstreamCacheShape {
  schemaVersion: number;
  updatedAt: string;
  entries: Array<{
    owner: string;
    slug: string;
    officialUrl: string;
    repoUrl: string;
    source: "index" | "page" | "search";
    resolvedAt: string;
  }>;
}

interface OfficialUpstreamResolutionReport {
  schemaVersion: number;
  generatedAt: string;
  resolvedCount: number;
  unresolvedCount: number;
  ambiguousCount: number;
  resolved: Array<{
    owner: string;
    slug: string;
    officialUrl: string;
    repoUrl: string;
    source: "index" | "page" | "search";
    sourceId?: string;
  }>;
  unresolved: Array<{
    owner: string;
    slug: string;
    officialUrl: string;
    reason: string;
    attemptedFallbacks: string[];
  }>;
  ambiguous: Array<{
    owner: string;
    slug: string;
    officialUrl: string;
    candidates: string[];
    reason: string;
  }>;
}

type OfficialUpstreamResolutionKind = "resolved" | "unresolved" | "ambiguous";

interface OfficialUpstreamResolutionState {
  cache: Map<string, OfficialUpstreamCacheShape["entries"][number]>;
  recordedOfficialKeys: Set<string>;
  recordedOfficialKeyKinds: Map<string, OfficialUpstreamResolutionKind>;
  resolved: OfficialUpstreamResolutionReport["resolved"];
  unresolved: OfficialUpstreamResolutionReport["unresolved"];
  ambiguous: OfficialUpstreamResolutionReport["ambiguous"];
}

const OFFICIAL_INDEX_ALLOWED_ORIGINS = [
  "https://raw.githubusercontent.com",
] as const;
const GITHUB_API_ALLOWED_ORIGINS = ["https://api.github.com"] as const;
const OFFICIAL_UPSTREAM_RESOLUTION_SCHEMA_VERSION = 1;
const OFFICIAL_UPSTREAM_CACHE_SCHEMA_VERSION = 1;

/**
 * Source priority assigned to an `official-first-party` authority tier.
 * 100 is the maximum priority weight; it signals that the source is the
 * canonical upstream for its asset family with no quality penalty.
 */
const OFFICIAL_FIRST_PARTY_SOURCE_PRIORITY = 100;

/**
 * Source priority assigned to authority tiers below `official-first-party`.
 * 70 represents a high-quality but non-canonical source — compatible or
 * officially-adjacent, but not the primary upstream owner.
 */
const NON_FIRST_PARTY_SOURCE_PRIORITY = 70;

/**
 * Provides harvest official skill indexes for the lifecycle pipeline.
 */
export async function harvestOfficialSkillIndexes(
  projectRoot: string,
  demandProfile: DemandProfile | null,
): Promise<AssetCatalogEntry[]> {
  const indexConfigPath = join(
    projectRoot,
    "discover",
    "official-skills-indexes.json",
  );
  const indexConfig =
    await readJsonFileOrNull<OfficialSkillIndexShape>(indexConfigPath);
  if (!indexConfig) {
    return [];
  }

  const officialUpstreamAllowlist =
    await loadOfficialUpstreamAllowlist(projectRoot);
  const resolutionState =
    await loadOfficialUpstreamResolutionState(projectRoot);
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const entries: AssetCatalogEntry[] = [];

  const seenIds = new Set<string>();
  const maxItemsPerIndex = getRuntimeConfig().officialIndex.maxItemsPerIndex;

  for (const index of indexConfig.indexes) {
    const content = await fetchOfficialIndexContent(index.url);
    if (!content) {
      continue;
    }

    const officialSkillRepoUrlsByOwnerAndSlug = extractOfficialSkillRepoUrls(
      content,
      officialUpstreamAllowlist,
    );

    /** Entries produced from this specific index (for per-index cap tracking). */
    let indexEntriesAdded = 0;

    for (const parsedEntry of parseOfficialIndexEntries(
      content,
      demandProfile,
    )) {
      // Apply per-index cap when configured (0 = unlimited).
      if (maxItemsPerIndex > 0 && indexEntriesAdded >= maxItemsPerIndex) {
        break;
      }
      const sourceIdParts = parsedEntry.source.sourceId.split(":");
      const owner = sourceIdParts[1]!;
      const manifestEntry = parsedEntry.install.manifestEntry!;
      const officialRepoUrl = await resolveOfficialRepoUrl({
        allowlist: officialUpstreamAllowlist,
        fallbackCandidates: officialSkillRepoUrlsByOwnerAndSlug,
        officialUrl: parsedEntry.source.originUrl,
        owner,
        resolutionState,
        slug: manifestEntry,
      });
      const entry = officialRepoUrl
        ? {
            ...parsedEntry,
            evidence: {
              ...parsedEntry.evidence,
              rootPath: officialRepoUrl,
            },
          }
        : parsedEntry;

      if (seenIds.has(entry.id)) {
        continue;
      }

      seenIds.add(entry.id);
      entries.push(entry);
      indexEntriesAdded++;

      const resolvedRepoSource = resolveOfficialIndexEntryToRepoSource(
        owner,
        manifestEntry,
        entry,
        sourceRegistry,
        officialRepoUrl,
      );
      if (resolvedRepoSource) {
        markResolvedSourceId(
          resolutionState,
          owner,
          manifestEntry,
          resolvedRepoSource.source.sourceId,
        );
        if (!seenIds.has(resolvedRepoSource.id)) {
          // Check per-index cap again before inserting the secondary source,
          // since the primary entry already consumed one slot this iteration.
          if (maxItemsPerIndex > 0 && indexEntriesAdded >= maxItemsPerIndex) {
            /* c8 ignore start — requires cap=1 */
            break;
          }
          /* c8 ignore stop */
          seenIds.add(resolvedRepoSource.id);
          entries.push(resolvedRepoSource);
          indexEntriesAdded++;
        }
      }
    }
  }

  await writeOfficialUpstreamResolutionState(projectRoot, resolutionState);

  return entries;
}

async function fetchOfficialIndexContent(url: string): Promise<string | null> {
  return fetchTextWithGuards(url, {
    allowedOrigins: OFFICIAL_INDEX_ALLOWED_ORIGINS,
    headers: buildOfficialIndexHeaders(),
    maxBytes: getRuntimeConfig().officialIndex.contentMaxBytes,
  });
}

function buildOfficialIndexHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": "agent-harness",
  };

  const githubToken = getRuntimeConfig().github.token;
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  return headers;
}

function parseOfficialIndexEntries(
  content: string,
  demandProfile: DemandProfile | null,
): AssetCatalogEntry[] {
  const matches = [
    ...content.matchAll(
      /\*\*\[([^\]]+)\]\((https:\/\/officialskills\.sh\/([^/]+)\/skills\/([^)]+))\)\*\*\s*-\s*([^\n]+)/gu,
    ),
  ];
  const entries: AssetCatalogEntry[] = [];

  for (const match of matches) {
    const displayName = match[1]!.trim();
    const originUrl = match[2]!.trim();
    const owner = match[3]!.trim();
    const slug = match[4]!.trim();
    const description = match[5]!.trim();

    if (!displayName || !originUrl || !owner || !slug) {
      continue;
    }

    const authorityTier = isOfficialIndexOwner(owner)
      ? "official-first-party"
      : "trusted-community";
    const capabilities = uniqueStrings([
      ...splitIntoKeywords(owner),
      ...splitIntoKeywords(slug),
      ...splitIntoKeywords(description),
    ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
    const hosts = owner.includes("scopeblind")
      ? (["copilot-vscode", "opencode", "shared"] satisfies HostTarget[])
      : (["copilot-vscode", "opencode"] satisfies HostTarget[]);
    const assetKind = determineOfficialIndexAssetKind(owner, slug, description);
    const compatibilityMode =
      authorityTier === "official-first-party"
        ? ("native" satisfies CompatibilityMode)
        : ("adaptable" satisfies CompatibilityMode);

    entries.push({
      id: buildCatalogId(`official-index:${owner}`, slug),
      displayName,
      assetKind,
      hosts,
      compatibilityMode,
      source: {
        sourceId: `official-index:${owner}`,
        authorityTier,
        sourceKind: "docs",
        sourcePriority:
          authorityTier === "official-first-party"
            ? OFFICIAL_FIRST_PARTY_SOURCE_PRIORITY
            : NON_FIRST_PARTY_SOURCE_PRIORITY,
        originUrl,
        publisher: owner,
        publisherVerified: authorityTier === "official-first-party",
      },
      trust: {
        score: computeTrustScore({
          authorityTier,
          sourceKind: "docs",
          sourcePriority:
            authorityTier === "official-first-party"
              ? OFFICIAL_FIRST_PARTY_SOURCE_PRIORITY
              : NON_FIRST_PARTY_SOURCE_PRIORITY,
          publisherVerified: authorityTier === "official-first-party",
          compatibilityMode,
          installMethod: "official-index-entry",
        }),
        signals: buildTrustSignals({
          authorityTier,
          sourceKind: "docs",
          sourcePriority:
            authorityTier === "official-first-party"
              ? OFFICIAL_FIRST_PARTY_SOURCE_PRIORITY
              : NON_FIRST_PARTY_SOURCE_PRIORITY,
          publisherVerified: authorityTier === "official-first-party",
          compatibilityMode,
          installMethod: "official-index-entry",
        }),
      },
      capabilities,
      install: {
        method: "official-index-entry",
        nativeHosts: compatibilityMode === "native" ? hosts : undefined,
        adaptableHosts: compatibilityMode === "adaptable" ? hosts : undefined,
        manifestEntry: slug,
      },
      evidence: {
        manifestFound: true,
        readmeFound: false,
        examplesFound: false,
        docsLinked: true,
        lineCount: 1,
        rootPath: originUrl,
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 0,
        releaseCadence: "index-listed",
      },
      risk: buildRisk(false, false, false),
      contextCost: {
        sizeClass: "tiny",
        estimatedPromptWeight: 1,
      },
      fit: {
        portfolioFit: computePortfolioFit(capabilities, demandProfile),
        hostFit: computeHostFit(hosts, compatibilityMode),
      },
      dedupe: {
        duplicateGroup: buildOfficialIndexDuplicateGroup(owner, slug),
        candidateRankHint: buildCandidateRankHint(authorityTier),
      },
      status: buildOfficialIndexAssetStatus(authorityTier),
    });
  }

  return entries;
}

function determineOfficialIndexAssetKind(
  owner: string,
  slug: string,
  description: string,
): AssetKind {
  const combinedText = `${owner} ${slug} ${description}`.toLowerCase();

  if (combinedText.includes("mcp")) {
    return "mcp-server";
  }

  if (combinedText.includes("workflow") || combinedText.includes("playbook")) {
    return "workflow";
  }

  if (
    combinedText.includes("guide") ||
    combinedText.includes("reference") ||
    combinedText.includes("cookbook")
  ) {
    return "reference-pack";
  }

  if (combinedText.includes("plugin") || combinedText.includes("extension")) {
    return "plugin";
  }

  return "skill";
}

function buildOfficialIndexDuplicateGroup(owner: string, slug: string): string {
  return `official-index:${owner}:${slug}`;
}

function normalizeGitHubRepoIdentity(
  repoUrl: string | undefined,
): string | null {
  if (!repoUrl) {
    return null;
  }

  const normalizedRepoUrl = repoUrl.trim().replace(/^git\+/iu, "");
  const httpsMatch =
    /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/iu.exec(
      normalizedRepoUrl,
    );
  const scpMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/iu.exec(
    normalizedRepoUrl,
  );
  const sshMatch =
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/iu.exec(
      normalizedRepoUrl,
    );
  const match = httpsMatch ?? scpMatch ?? sshMatch;

  if (!match) {
    return null;
  }

  return `${match[1]!}/${match[2]!.replace(/\.git$/iu, "")}`.toLowerCase();
}

function isOfficialIndexOwner(owner: string): boolean {
  return [
    "anthropics",
    "supabase",
    "google-gemini",
    "stripe",
    "trycourier",
    "callstackincubator",
    "better-auth",
    "tinybirdco",
    "hashicorp",
    "sanity-io",
    "firecrawl",
    "neondatabase",
    "clickhouse",
    "remotion-dev",
    "replicate",
    "typefully",
    "vercel-labs",
    "cloudflare",
    "netlify",
    "google-labs",
    "huggingface",
    "microsoft",
    "openai",
    "figma",
    "expo",
    "flutter",
    "genkit-ai",
    "firebase",
    "apify",
    "duckdb",
    "scopeblind",
  ].includes(owner);
}

function resolveOfficialIndexEntryToRepoSource(
  owner: string,
  slug: string,
  entry: AssetCatalogEntry,
  sourceRegistry: { sources: SourceDefinition[] },
  officialRepoUrl?: string,
): AssetCatalogEntry | null {
  const officialRepoIdentity = normalizeGitHubRepoIdentity(officialRepoUrl);
  const expectedFallbackIdentity = normalizeGitHubRepoIdentity(
    `https://github.com/${owner}/${slug}`,
  );
  const matchingSource = sourceRegistry.sources.find((source) => {
    const sourceRepoIdentity = normalizeGitHubRepoIdentity(
      source.endpoints.repo,
    );
    if (!sourceRepoIdentity) {
      return false;
    }

    if (officialRepoIdentity) {
      return sourceRepoIdentity === officialRepoIdentity;
    }

    return (
      sourceRepoIdentity === expectedFallbackIdentity &&
      source.authorityTier === entry.source.authorityTier
    );
  });

  if (!matchingSource) {
    return null;
  }

  return {
    ...entry,
    id: buildCatalogId(matchingSource.id, slug),
    source: {
      sourceId: matchingSource.id,
      authorityTier: matchingSource.authorityTier,
      sourceKind: matchingSource.kind,
      sourcePriority: matchingSource.priority,
      originUrl: matchingSource.endpoints.repo!,
      publisher: matchingSource.publisher?.name ?? entry.source.publisher,
      publisherVerified:
        matchingSource.publisher?.verified ?? entry.source.publisherVerified,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: matchingSource.authorityTier,
        sourceKind: matchingSource.kind,
        sourcePriority: matchingSource.priority,
        publisherVerified: matchingSource.publisher?.verified ?? false,
        compatibilityMode: entry.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
      signals: buildTrustSignals({
        authorityTier: matchingSource.authorityTier,
        sourceKind: matchingSource.kind,
        sourcePriority: matchingSource.priority,
        publisherVerified: matchingSource.publisher?.verified ?? false,
        compatibilityMode: entry.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
    },
    install: {
      ...entry.install,
      method: "github-tree-metadata",
    },
    evidence: {
      ...entry.evidence,
      rootPath: matchingSource.endpoints.repo!,
    },
    maintenance: {
      ...entry.maintenance,
      releaseCadence: "active",
    },
    dedupe: {
      ...entry.dedupe,
      duplicateGroup: buildOfficialIndexDuplicateGroup(owner, slug),
    },
    status: {
      ...entry.status,
      mirrorEligible: matchingSource.rules.allowMirror,
      installEligible:
        matchingSource.rules.allowMirror && matchingSource.rules.allowInstall,
      activationEligible:
        matchingSource.rules.allowMirror && matchingSource.rules.allowInstall,
    },
  };
}

async function resolveOfficialRepoUrl(input: {
  allowlist: Record<string, string[]>;
  fallbackCandidates: Map<string, string>;
  officialUrl: string;
  owner: string;
  resolutionState: OfficialUpstreamResolutionState;
  slug: string;
}): Promise<string | undefined> {
  const owner = input.owner.toLowerCase();
  const slug = normalizeOfficialSkillSlug(input.slug);
  const key = buildOfficialUpstreamKey(owner, slug);
  const cachedEntry = input.resolutionState.cache.get(key);
  if (cachedEntry) {
    recordResolvedOfficialUpstream(input.resolutionState, {
      officialUrl: input.officialUrl,
      owner,
      repoUrl: cachedEntry.repoUrl,
      slug,
      source: cachedEntry.source,
    });
    return cachedEntry.repoUrl;
  }

  if (hasRecordedOfficialUpstreamResolution(input.resolutionState, key)) {
    return undefined;
  }

  const fallbackRepoUrl = input.fallbackCandidates.get(key);
  if (fallbackRepoUrl) {
    return recordResolvedOfficialRepoUrl(input.resolutionState, {
      officialUrl: input.officialUrl,
      owner,
      repoUrl: fallbackRepoUrl,
      slug,
      source: "index",
    });
  }

  const pageRepoUrl = await fetchOfficialIndexPageRepositoryUrl(
    input.officialUrl,
  );
  if (pageRepoUrl) {
    const normalizedRepoIdentity = normalizeGitHubRepoIdentity(pageRepoUrl);
    const repoOwner = normalizedRepoIdentity?.split("/")[0];
    if (
      repoOwner &&
      isAllowedOfficialRepoOwner(owner, repoOwner, input.allowlist)
    ) {
      return recordResolvedOfficialRepoUrl(input.resolutionState, {
        officialUrl: input.officialUrl,
        owner,
        repoUrl: pageRepoUrl,
        slug,
        source: "page",
      });
    }

    recordAmbiguousOfficialUpstream(input.resolutionState, {
      candidates: [pageRepoUrl],
      officialUrl: input.officialUrl,
      owner,
      reason:
        "Page advertised a GitHub repository outside the allowed owner set.",
      slug,
    });
    return undefined;
  }

  const searchCandidates = await searchOfficialRepoCandidates({
    allowlist: input.allowlist,
    owner,
    slug,
  });
  if (searchCandidates.length === 1) {
    return recordResolvedOfficialRepoUrl(input.resolutionState, {
      officialUrl: input.officialUrl,
      owner,
      repoUrl: searchCandidates[0]!,
      slug,
      source: "search",
    });
  }
  if (searchCandidates.length > 1) {
    recordAmbiguousOfficialUpstream(input.resolutionState, {
      candidates: searchCandidates,
      officialUrl: input.officialUrl,
      owner,
      reason: "Repository search found multiple allowed owner candidates.",
      slug,
    });
    return undefined;
  }

  recordUnresolvedOfficialUpstream(input.resolutionState, {
    attemptedFallbacks: [
      "official index adjacent repository link",
      "official page repository extraction",
      "GitHub repository search",
    ],
    officialUrl: input.officialUrl,
    owner,
    reason:
      "No canonical GitHub repository was advertised by the official index, page, or repository search.",
    slug,
  });
  return undefined;
}

async function searchOfficialRepoCandidates(input: {
  allowlist: Record<string, string[]>;
  owner: string;
  slug: string;
}): Promise<string[]> {
  const candidates: string[] = [];
  const allowedOwners = input.allowlist[input.owner] ?? [input.owner];

  for (const allowedOwner of allowedOwners) {
    const searchUrl = new URL("https://api.github.com/search/repositories");
    searchUrl.searchParams.set(
      "q",
      `${input.slug} in:name user:${allowedOwner}`,
    );
    searchUrl.searchParams.set("per_page", "5");
    const data = await fetchJsonWithGuards(searchUrl.toString(), {
      allowedOrigins: GITHUB_API_ALLOWED_ORIGINS,
      headers: buildOfficialIndexHeaders(),
      maxBytes: getRuntimeConfig().officialIndex.contentMaxBytes,
    });
    const response = data as GitHubSearchResponseShape | null;
    for (const item of response?.items ?? []) {
      const fullName = typeof item.full_name === "string" ? item.full_name : "";
      const htmlUrl = typeof item.html_url === "string" ? item.html_url : "";
      const [repoOwner, repoName] = fullName.toLowerCase().split("/");
      if (
        !repoOwner ||
        !repoName ||
        normalizeOfficialSkillSlug(repoName) !== input.slug ||
        !isAllowedOfficialRepoOwner(input.owner, repoOwner, input.allowlist)
      ) {
        continue;
      }

      const normalizedCandidate = normalizeGitHubRepositoryUrl(htmlUrl);
      if (normalizedCandidate) {
        candidates.push(normalizedCandidate);
      }
    }
  }

  return uniqueStrings(candidates).sort();
}

function normalizeGitHubRepositoryUrl(repoUrl: string): string | null {
  const normalizedRepoIdentity = normalizeGitHubRepoIdentity(repoUrl);
  return normalizedRepoIdentity
    ? `https://github.com/${normalizedRepoIdentity}`
    : null;
}

function recordResolvedOfficialRepoUrl(
  resolutionState: OfficialUpstreamResolutionState,
  input: {
    officialUrl: string;
    owner: string;
    repoUrl: string;
    slug: string;
    source: "index" | "page" | "search";
  },
): string {
  const normalizedRepoIdentity = normalizeGitHubRepoIdentity(input.repoUrl);
  const repoUrl = normalizedRepoIdentity
    ? `https://github.com/${normalizedRepoIdentity}`
    : input.repoUrl;
  const resolvedAt = new Date().toISOString();
  resolutionState.cache.set(buildOfficialUpstreamKey(input.owner, input.slug), {
    owner: input.owner,
    slug: input.slug,
    officialUrl: input.officialUrl,
    repoUrl,
    source: input.source,
    resolvedAt,
  });
  recordResolvedOfficialUpstream(resolutionState, {
    officialUrl: input.officialUrl,
    owner: input.owner,
    repoUrl,
    slug: input.slug,
    source: input.source,
  });
  return repoUrl;
}

function hasRecordedOfficialUpstreamResolution(
  resolutionState: OfficialUpstreamResolutionState,
  key: string,
): boolean {
  return resolutionState.recordedOfficialKeys.has(key);
}

function recordResolvedOfficialUpstream(
  resolutionState: OfficialUpstreamResolutionState,
  input: {
    officialUrl: string;
    owner: string;
    repoUrl: string;
    slug: string;
    source: "index" | "page" | "search";
  },
): void {
  const key = buildOfficialUpstreamKey(input.owner, input.slug);
  const recordedKind = resolutionState.recordedOfficialKeyKinds.get(key);
  if (recordedKind === "resolved") {
    return;
  }
  if (recordedKind === "unresolved") {
    resolutionState.unresolved = resolutionState.unresolved.filter(
      (entry) => !hasOfficialUpstreamKey(entry, key),
    );
  }
  if (recordedKind === "ambiguous") {
    resolutionState.ambiguous = resolutionState.ambiguous.filter(
      (entry) => !hasOfficialUpstreamKey(entry, key),
    );
  }

  resolutionState.resolved.push({
    owner: input.owner,
    slug: input.slug,
    officialUrl: input.officialUrl,
    repoUrl: input.repoUrl,
    source: input.source,
  });
  recordOfficialUpstreamKey(resolutionState, key, "resolved");
}

function markResolvedSourceId(
  resolutionState: OfficialUpstreamResolutionState,
  owner: string,
  slug: string,
  sourceId: string,
): void {
  const key = buildOfficialUpstreamKey(owner, slug);
  const resolvedEntry = resolutionState.resolved.find((entry) =>
    hasOfficialUpstreamKey(entry, key),
  );
  if (resolvedEntry) {
    resolvedEntry.sourceId = sourceId;
  }
}

function recordUnresolvedOfficialUpstream(
  resolutionState: OfficialUpstreamResolutionState,
  entry: OfficialUpstreamResolutionReport["unresolved"][number],
): void {
  const key = buildOfficialUpstreamKey(entry.owner, entry.slug);
  if (resolutionState.recordedOfficialKeys.has(key)) {
    return;
  }

  resolutionState.unresolved.push(entry);
  recordOfficialUpstreamKey(resolutionState, key, "unresolved");
}

function recordAmbiguousOfficialUpstream(
  resolutionState: OfficialUpstreamResolutionState,
  entry: OfficialUpstreamResolutionReport["ambiguous"][number],
): void {
  const key = buildOfficialUpstreamKey(entry.owner, entry.slug);
  if (resolutionState.recordedOfficialKeys.has(key)) {
    return;
  }

  resolutionState.ambiguous.push(entry);
  recordOfficialUpstreamKey(resolutionState, key, "ambiguous");
}

function createOfficialUpstreamResolutionState(input: {
  cache?: Map<string, OfficialUpstreamCacheShape["entries"][number]>;
  resolved?: OfficialUpstreamResolutionReport["resolved"];
  unresolved?: OfficialUpstreamResolutionReport["unresolved"];
  ambiguous?: OfficialUpstreamResolutionReport["ambiguous"];
}): OfficialUpstreamResolutionState {
  const cache = new Map<
    string,
    OfficialUpstreamCacheShape["entries"][number]
  >();
  const resolutionState: OfficialUpstreamResolutionState = {
    cache: input.cache ?? cache,
    recordedOfficialKeys: new Set(),
    recordedOfficialKeyKinds: new Map(),
    resolved: input.resolved ?? [],
    unresolved: input.unresolved ?? [],
    ambiguous: input.ambiguous ?? [],
  };
  for (const entry of resolutionState.resolved) {
    recordOfficialUpstreamKey(
      resolutionState,
      buildOfficialUpstreamKey(entry.owner, entry.slug),
      "resolved",
    );
  }
  for (const entry of resolutionState.unresolved) {
    recordOfficialUpstreamKey(
      resolutionState,
      buildOfficialUpstreamKey(entry.owner, entry.slug),
      "unresolved",
    );
  }
  for (const entry of resolutionState.ambiguous) {
    recordOfficialUpstreamKey(
      resolutionState,
      buildOfficialUpstreamKey(entry.owner, entry.slug),
      "ambiguous",
    );
  }

  return resolutionState;
}

function recordOfficialUpstreamKey(
  resolutionState: OfficialUpstreamResolutionState,
  key: string,
  kind: OfficialUpstreamResolutionKind,
): void {
  resolutionState.recordedOfficialKeys.add(key);
  resolutionState.recordedOfficialKeyKinds.set(key, kind);
}

function hasOfficialUpstreamKey(
  entry: { owner: string; slug: string },
  key: string,
): boolean {
  return buildOfficialUpstreamKey(entry.owner, entry.slug) === key;
}

async function loadOfficialUpstreamResolutionState(
  projectRoot: string,
): Promise<OfficialUpstreamResolutionState> {
  const cache = await readJsonFileOrNull<OfficialUpstreamCacheShape>(
    join(projectRoot, ...OFFICIAL_UPSTREAM_CACHE_STATE_PATH),
  );

  return createOfficialUpstreamResolutionState({
    cache: new Map(
      (cache?.entries ?? []).map((entry) => [
        buildOfficialUpstreamKey(entry.owner, entry.slug),
        entry,
      ]),
    ),
  });
}

async function writeOfficialUpstreamResolutionState(
  projectRoot: string,
  resolutionState: OfficialUpstreamResolutionState,
): Promise<void> {
  const generatedAt = new Date().toISOString();
  const cacheEntries = [...resolutionState.cache.values()].sort(
    compareOfficialUpstreamEntries,
  );
  await writeJsonFile(
    join(projectRoot, ...OFFICIAL_UPSTREAM_CACHE_STATE_PATH),
    {
      schemaVersion: OFFICIAL_UPSTREAM_CACHE_SCHEMA_VERSION,
      updatedAt: generatedAt,
      entries: cacheEntries,
    } satisfies OfficialUpstreamCacheShape,
  );

  await writeJsonFile(
    join(projectRoot, ...OFFICIAL_UPSTREAM_RESOLUTION_OUTPUT_PATH),
    {
      schemaVersion: OFFICIAL_UPSTREAM_RESOLUTION_SCHEMA_VERSION,
      generatedAt,
      resolvedCount: resolutionState.resolved.length,
      unresolvedCount: resolutionState.unresolved.length,
      ambiguousCount: resolutionState.ambiguous.length,
      resolved: [...resolutionState.resolved].sort(
        compareOfficialUpstreamEntries,
      ),
      unresolved: [...resolutionState.unresolved].sort(
        compareOfficialUpstreamEntries,
      ),
      ambiguous: [...resolutionState.ambiguous].sort(
        compareOfficialUpstreamEntries,
      ),
    } satisfies OfficialUpstreamResolutionReport,
  );
}

function compareOfficialUpstreamEntries(
  left: { owner: string; slug: string },
  right: { owner: string; slug: string },
): number {
  return buildOfficialUpstreamKey(left.owner, left.slug).localeCompare(
    buildOfficialUpstreamKey(right.owner, right.slug),
  );
}

function buildOfficialUpstreamKey(owner: string, slug: string): string {
  return `${owner.toLowerCase()}:${normalizeOfficialSkillSlug(slug)}`;
}

async function loadOfficialUpstreamAllowlist(
  projectRoot: string,
): Promise<Record<string, string[]>> {
  const allowlist = await readJsonFileOrNull<OfficialUpstreamAllowlistShape>(
    join(projectRoot, "discover", "official-upstreams.json"),
  );

  return Object.fromEntries(
    Object.entries(allowlist?.owners ?? {}).map(([owner, repoOwners]) => [
      owner.toLowerCase(),
      repoOwners.map((repoOwner) => repoOwner.toLowerCase()),
    ]),
  );
}

function extractOfficialSkillRepoUrls(
  content: string,
  allowlist: Record<string, string[]>,
): Map<string, string> {
  const repoUrls = new Map<string, string>();
  const blocks = content.split(/(?=^#\s+)/mu);

  for (const block of blocks) {
    const officialEntryMatch =
      /officialskills\.sh\/([^/]+)\/skills\/([^\s)]+)/u.exec(block);
    const repoMatch = /https:\/\/github\.com\/([^/]+\/[^/\s)]+)/u.exec(block);
    if (!officialEntryMatch || !repoMatch) {
      continue;
    }

    const officialOwner = officialEntryMatch[1]!.trim().toLowerCase();
    const slug = normalizeOfficialSkillSlug(officialEntryMatch[2]!);
    const repoIdentity = repoMatch[1]!;
    const repoOwner = repoIdentity.split("/")[0]!.toLowerCase();
    if (
      !repoOwner ||
      !isAllowedOfficialRepoOwner(officialOwner, repoOwner, allowlist)
    ) {
      continue;
    }

    repoUrls.set(
      `${officialOwner}:${slug}`,
      `https://github.com/${repoIdentity}`,
    );
  }

  return repoUrls;
}

function normalizeOfficialSkillSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function isAllowedOfficialRepoOwner(
  officialOwner: string,
  repoOwner: string,
  allowlist: Record<string, string[]>,
): boolean {
  const allowedOwners = allowlist[officialOwner] ?? [officialOwner];
  return allowedOwners.includes(repoOwner);
}

/**
 * Exposes narrow official-index internals for focused resolution coverage.
 */
export const officialIndexHarvesterInternals = {
  buildOfficialUpstreamKey,
  createOfficialUpstreamResolutionState,
  extractOfficialSkillRepoUrls,
  normalizeGitHubRepositoryUrl,
  recordAmbiguousOfficialUpstream,
  recordResolvedOfficialUpstream,
  recordUnresolvedOfficialUpstream,
  resolveOfficialRepoUrl,
  searchOfficialRepoCandidates,
};
