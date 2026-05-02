import {
  fetchGitHubRepoSnapshot,
  type GitHubRepoSnapshot,
} from "../../github.js";
import type {
  AssetCatalogEntry,
  AssetKind,
  AssetRisk,
  CompatibilityMode,
  DemandProfile,
  HostTarget,
  SelectionRegistry,
  SourceDefinition,
} from "../../types.js";
import {
  buildAssetStatus,
  buildCandidateRankHint,
  buildCatalogId,
  buildTrustSignals,
  computeHostFit,
  computePortfolioFit,
  computeTrustScore,
  findDuplicateGroup,
  GENERIC_CAPABILITY_TOKENS,
  humanizeSlug,
  lastPathSegment,
  splitIntoKeywords,
  uniqueStrings,
} from "./catalog-utils.js";

export async function harvestGitHubRepoSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  try {
    const snapshot = await fetchGitHubRepoSnapshot(source, projectRoot);

    if (!snapshot) {
      return [];
    }

    return snapshot.tree.entries
      .map((entry) =>
        buildGitHubCatalogEntry(
          snapshot,
          source,
          entry.path,
          demandProfile,
          selectionRegistry,
        ),
      )
      .filter((entry): entry is AssetCatalogEntry => entry !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping repo source ${source.id}: ${errorMessage}`);
    return [];
  }
}

function buildGitHubCatalogEntry(
  snapshot: GitHubRepoSnapshot,
  source: SourceDefinition,
  relativePath: string,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): AssetCatalogEntry | null {
  const classification = classifyGitHubTreePath(relativePath, source);

  if (!classification) {
    return null;
  }

  const capabilities = collectGitHubCapabilities(relativePath, snapshot);
  const hosts =
    classification.assetKind === "mcp-server"
      ? (["shared"] satisfies HostTarget[])
      : classification.hosts;
  const contextCost = { sizeClass: "tiny", estimatedPromptWeight: 1 } as const;
  const risk = buildGitHubRisk(classification.assetKind);
  const githubFileUrl = `${snapshot.repoSummary.htmlUrl}/blob/${snapshot.repoSummary.defaultBranch}/${relativePath}`;

  return {
    id: buildCatalogId(source.id, relativePath),
    displayName: humanizeSlug(lastPathSegment(relativePath)),
    assetKind: classification.assetKind,
    hosts,
    compatibilityMode: classification.compatibilityMode,
    source: {
      sourceId: source.id,
      authorityTier: source.authorityTier,
      sourceKind: source.kind,
      sourcePriority: source.priority,
      originUrl: githubFileUrl,
      publisher: source.publisher?.name ?? source.id,
      publisherVerified: source.publisher?.verified ?? false,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode: classification.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
      signals: buildTrustSignals({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode: classification.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
    },
    capabilities,
    install: {
      method: "github-tree-metadata",
      nativeHosts:
        classification.compatibilityMode === "native" ? hosts : undefined,
      adaptableHosts:
        classification.compatibilityMode === "adaptable" ? hosts : undefined,
      relativePath,
    },
    evidence: {
      manifestFound: true,
      readmeFound: snapshot.readme !== null,
      examplesFound: false,
      docsLinked: true,
      filePath: relativePath,
      rootPath: snapshot.repoSummary.htmlUrl,
    },
    maintenance: {
      lastUpdated: snapshot.repoSummary.updatedAt ?? snapshot.fetchedAt,
      stars: snapshot.repoSummary.stars,
      releaseCadence: snapshot.repoSummary.archived ? "archived" : "active",
    },
    risk,
    contextCost,
    fit: {
      portfolioFit: computePortfolioFit(capabilities, demandProfile),
      hostFit: computeHostFit(hosts, classification.compatibilityMode),
    },
    dedupe: {
      duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
      candidateRankHint: buildCandidateRankHint(source.authorityTier),
    },
    status: buildAssetStatus(source),
  };
}

function classifyGitHubTreePath(
  relativePath: string,
  source: SourceDefinition,
): {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  hosts: HostTarget[];
} | null {
  const normalizedPath = relativePath.toLowerCase();
  const nativeHosts = source.hosts.length === 1 ? source.hosts : undefined;
  const adaptableHosts = source.hosts.length > 1 ? source.hosts : source.hosts;

  if (
    normalizedPath.endsWith("/skill.md") ||
    normalizedPath.endsWith("/skill.md")
  ) {
    return {
      assetKind: "skill",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(agents?|subagents)(\/|$)/u.test(normalizedPath) &&
    normalizedPath.endsWith(".md")
  ) {
    return {
      assetKind: "agent",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    normalizedPath.endsWith("copilot-instructions.md") ||
    (/(^|\/)(instructions?)(\/|$)/u.test(normalizedPath) &&
      normalizedPath.endsWith(".md"))
  ) {
    return {
      assetKind: "instruction",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(workflows?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|ya?ml|json)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "workflow",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(hooks?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|sh|js|ts|ya?ml|json)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "hook",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(plugins?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|sh|js|ts|json)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "plugin",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /mcp/u.test(normalizedPath) &&
    /\.(md|json|js|ts|ya?ml)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "mcp-server",
      compatibilityMode: "native",
      hosts: ["shared"],
    };
  }

  if (isGenericRepositoryArtifact(normalizedPath)) {
    return {
      assetKind: "reference-pack",
      compatibilityMode: "reference-only",
      hosts: source.hosts,
    };
  }

  return null;
}

function isGenericRepositoryArtifact(normalizedPath: string): boolean {
  return (
    /(^|\/)(readme|docs?|notebooks?|data|datasets?|research|papers?|design|media|cad|hardware|firmware|models?|examples?)(\/|\.|$)/u.test(
      normalizedPath,
    ) ||
    /\.(ipynb|csv|parquet|jsonl|bib|tex|stl|step|kicad_pcb|uproject|godot)$/u.test(
      normalizedPath,
    )
  );
}

function collectGitHubCapabilities(
  relativePath: string,
  snapshot: GitHubRepoSnapshot,
): string[] {
  return uniqueStrings([
    ...snapshot.repoSummary.topics,
    ...(snapshot.repoSummary.language ? [snapshot.repoSummary.language] : []),
    ...splitIntoKeywords(snapshot.repoSummary.fullName),
    ...splitIntoKeywords(snapshot.repoSummary.description ?? ""),
    ...splitIntoKeywords(relativePath),
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
}

function buildGitHubRisk(assetKind: AssetKind): AssetRisk {
  if (assetKind === "plugin" || assetKind === "hook") {
    return {
      level: "medium",
      hasHooks: assetKind === "hook",
      hasExecScripts: true,
      requiresNetwork: false,
    };
  }

  return {
    level: "low",
    hasHooks: false,
    hasExecScripts: false,
    requiresNetwork: false,
  };
}
