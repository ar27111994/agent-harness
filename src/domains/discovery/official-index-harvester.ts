import { join } from "node:path";

import type {
  AssetCatalogEntry,
  AssetKind,
  CompatibilityMode,
  DemandProfile,
  HostTarget,
} from "../../types.js";
import { getRuntimeConfig } from "../../config/runtime.js";
import { readJsonFileOrNull } from "../../files.js";
import { fetchTextWithGuards } from "../../lib/http.js";
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

const OFFICIAL_INDEX_ALLOWED_ORIGINS = [
  "https://raw.githubusercontent.com",
] as const;

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
  const entries: AssetCatalogEntry[] = [];

  const seenIds = new Set<string>();

  for (const index of indexConfig.indexes) {
    const content = await fetchOfficialIndexContent(index.url);
    if (!content) {
      continue;
    }

    const officialSkillRepoUrlsByOwnerAndSlug = extractOfficialSkillRepoUrls(
      content,
      officialUpstreamAllowlist,
    );

    for (const parsedEntry of parseOfficialIndexEntries(
      content,
      demandProfile,
    )) {
      const sourceIdParts = parsedEntry.source.sourceId.split(":");
      const owner = sourceIdParts[1]!;
      const manifestEntry = parsedEntry.install.manifestEntry!;
      const officialRepoUrl = officialSkillRepoUrlsByOwnerAndSlug.get(
        `${owner}:${manifestEntry}`,
      );
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

      const resolvedRepoSource = await resolveOfficialIndexEntryToRepoSource(
        owner,
        manifestEntry,
        entry,
        projectRoot,
        officialRepoUrl,
      );
      if (resolvedRepoSource && !seenIds.has(resolvedRepoSource.id)) {
        seenIds.add(resolvedRepoSource.id);
        entries.push(resolvedRepoSource);
      }
    }
  }

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
        sourcePriority: authorityTier === "official-first-party" ? 100 : 70,
        originUrl,
        publisher: owner,
        publisherVerified: authorityTier === "official-first-party",
      },
      trust: {
        score: computeTrustScore({
          authorityTier,
          sourceKind: "docs",
          sourcePriority: authorityTier === "official-first-party" ? 100 : 70,
          publisherVerified: authorityTier === "official-first-party",
          compatibilityMode,
          installMethod: "official-index-entry",
        }),
        signals: buildTrustSignals({
          authorityTier,
          sourceKind: "docs",
          sourcePriority: authorityTier === "official-first-party" ? 100 : 70,
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

async function resolveOfficialIndexEntryToRepoSource(
  owner: string,
  slug: string,
  entry: AssetCatalogEntry,
  projectRoot: string,
  officialRepoUrl?: string,
): Promise<AssetCatalogEntry | null> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
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
    const slug = officialEntryMatch[2]!
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
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

function isAllowedOfficialRepoOwner(
  officialOwner: string,
  repoOwner: string,
  allowlist: Record<string, string[]>,
): boolean {
  const allowedOwners = allowlist[officialOwner] ?? [officialOwner];
  return allowedOwners.includes(repoOwner);
}
