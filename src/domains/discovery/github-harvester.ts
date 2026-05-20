import { fetchGitHubRepoSnapshot } from "../../github.js";
import type {
  AssetCatalogEntry,
  AssetKind,
  AssetRisk,
  CompatibilityMode,
  DemandProfile,
  GitHubRepoSnapshot,
  HostTarget,
  SelectionRegistry,
  SourceDefinition,
} from "../../types.js";
import {
  buildAssetStatus,
  buildCandidateRankHint,
  buildCatalogId,
  buildTrustSignals,
  deriveDisplayNameFromPath,
  computeHostFit,
  computePortfolioFit,
  computeTrustScore,
  findDuplicateGroup,
  GENERIC_CAPABILITY_TOKENS,
  splitIntoKeywords,
  uniqueStrings,
} from "./catalog-utils.js";

type FetchGitHubRepoSnapshot = typeof fetchGitHubRepoSnapshot;

/**
 * Provides harvest git hub repo source for the lifecycle pipeline.
 */
export async function harvestGitHubRepoSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
  fetchSnapshot: FetchGitHubRepoSnapshot = fetchGitHubRepoSnapshot,
): Promise<AssetCatalogEntry[]> {
  try {
    const snapshot = await fetchSnapshot(source, projectRoot);

    if (!snapshot) {
      return [];
    }

    if (snapshot.tree.truncated) {
      console.warn(
        `Skipping repo source ${source.id}: GitHub tree response was truncated.`,
      );
      return [];
    }

    return snapshot.tree.entries
      .filter((entry) => entry.type === "blob")
      .map((entry) =>
        buildGitHubCatalogEntry(
          snapshot,
          source,
          entry,
          demandProfile,
          selectionRegistry,
        ),
      )
      .filter((entry): entry is AssetCatalogEntry => entry !== null);
  } catch (error) {
    console.warn(
      `Skipping repo source ${source.id}: ${toGitHubHarvesterErrorMessage(error)}`,
    );
    return [];
  }
}

function buildGitHubCatalogEntry(
  snapshot: GitHubRepoSnapshot,
  source: SourceDefinition,
  treeEntry: GitHubRepoSnapshot["tree"]["entries"][number],
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): AssetCatalogEntry | null {
  const relativePath = treeEntry.path;
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
  const repoTrust = collectRepositoryTrustEvidence(snapshot);
  const githubFileUrl = `${snapshot.repoSummary.htmlUrl}/blob/${snapshot.repoSummary.defaultBranch}/${relativePath}`;

  return {
    id: buildCatalogId(source.id, relativePath),
    displayName: deriveDisplayNameFromPath(relativePath),
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
      score:
        computeTrustScore({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode: classification.compatibilityMode,
          installMethod: "github-tree-metadata",
        }) + repoTrust.scoreBonus,
      signals: [
        ...buildTrustSignals({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode: classification.compatibilityMode,
          installMethod: "github-tree-metadata",
        }),
        ...repoTrust.signals,
      ],
    },
    capabilities,
    install: {
      method: "github-tree-metadata",
      nativeHosts:
        classification.compatibilityMode === "native" ? hosts : undefined,
      adaptableHosts:
        classification.compatibilityMode === "adaptable" ? hosts : undefined,
      relativePath,
      manifestEntry: treeEntry.sha,
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

function collectRepositoryTrustEvidence(snapshot: GitHubRepoSnapshot): {
  scoreBonus: number;
  signals: string[];
} {
  const paths = snapshot.tree.entries.map((entry) => entry.path.toLowerCase());
  const signals: string[] = [];
  let scoreBonus = 0;

  if (paths.some((path) => /(^|\/)security\.md$/u.test(path))) {
    signals.push("security-policy-present");
    scoreBonus += 3;
  }
  if (paths.some((path) => /(^|\/)licen[sc]e(\.|$)/u.test(path))) {
    signals.push("license-present");
    scoreBonus += 2;
  }
  if (paths.some((path) => path.startsWith(".github/workflows/"))) {
    signals.push("ci-workflows-present");
    scoreBonus += 2;
  }
  if (
    paths.some((path) => /(^|\/)(test|tests|spec|__tests__)(\/|$)/u.test(path))
  ) {
    signals.push("tests-present");
    scoreBonus += 2;
  }

  return { scoreBonus, signals };
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
  const adaptableHosts = source.hosts;
  const pathFilterMatched = matchesSourcePathFilters(normalizedPath, source);

  if (!pathFilterMatched) {
    return null;
  }

  if (normalizedPath.endsWith("/skill.md")) {
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
    /(^|\/)(?:agents|claude)\.md$/u.test(normalizedPath) ||
    (/(^|\/)(?:instructions?|rules?)(\/|$)/u.test(normalizedPath) &&
      /\.(?:md|mdc)$/u.test(normalizedPath))
  ) {
    return {
      assetKind: "instruction",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(?:commands?|prompts?|prompt-templates?)(\/|$)/u.test(
      normalizedPath,
    ) &&
    normalizedPath.endsWith(".md")
  ) {
    return {
      assetKind: "prompt-pack",
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
    (/\.claude-plugin\/plugin\.json$/u.test(normalizedPath) ||
      /\.cursor-plugin\/plugin\.json$/u.test(normalizedPath) ||
      /(^|\/)(plugins?)(\/|$)/u.test(normalizedPath)) &&
    /\.(md|sh|js|ts|json)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "plugin",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (isExecutableMcpServerPath(normalizedPath, source, pathFilterMatched)) {
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

function matchesSourcePathFilters(
  normalizedPath: string,
  source: SourceDefinition,
): boolean {
  if (
    source.excludePaths?.some((pathPattern) =>
      matchesSourcePathPattern(normalizedPath, pathPattern),
    )
  ) {
    return false;
  }

  if (!source.includePaths || source.includePaths.length === 0) {
    return true;
  }

  return source.includePaths.some((pathPattern) =>
    matchesSourcePathPattern(normalizedPath, pathPattern),
  );
}

function matchesSourcePathPattern(
  normalizedPath: string,
  pathPattern: string,
): boolean {
  const normalizedTreePath = normalizeSourceFilterPath(normalizedPath);
  const normalizedPattern = normalizeSourceFilterPath(pathPattern);

  if (normalizedPattern.endsWith("/**")) {
    return normalizedTreePath.startsWith(normalizedPattern.slice(0, -3));
  }

  return normalizedTreePath === normalizedPattern;
}

function normalizeSourceFilterPath(value: string): string {
  let normalizedValue = value.trim().toLowerCase().replaceAll("\\", "/");
  while (normalizedValue.startsWith("./")) {
    normalizedValue = normalizedValue.slice(2);
  }
  while (normalizedValue.startsWith("/")) {
    normalizedValue = normalizedValue.slice(1);
  }
  return normalizedValue;
}

function isExecutableMcpServerPath(
  normalizedPath: string,
  source: SourceDefinition,
  pathFilterMatched: boolean,
): boolean {
  if (!/\.(js|ts|mjs|cjs|mts|cts)$/u.test(normalizedPath)) {
    return false;
  }

  if (
    pathFilterMatched &&
    source.includePaths &&
    source.includePaths.length > 0 &&
    source.assetKinds.includes("mcp-server")
  ) {
    return true;
  }

  return /(^|\/)(mcp[-_ ]?servers?|servers?\/.*mcp|.*mcp[-_ ]?server.*)(\/|\.|$)/u.test(
    normalizedPath,
  );
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

function toGitHubHarvesterErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
