import {
  extractRepositoryUrlFromNpmMetadata,
  extractRepositoryUrlFromPypiMetadata,
  fetchNpmPackageMetadata,
  fetchNpmPackageSearch,
  fetchPypiPackageMetadata,
} from "../../package-registries.js";
import type {
  AssetCatalogEntry,
  AssetKind,
  CompatibilityMode,
  DemandProfile,
  HostTarget,
  SelectionRegistry,
  SourceDefinition,
} from "../../types.js";
import {
  buildCandidateRankHint,
  buildCatalogId,
  buildRisk,
  buildTrustSignals,
  computeHostFit,
  computePortfolioFit,
  computeTrustScore,
  findDuplicateGroup,
  GENERIC_CAPABILITY_TOKENS,
  splitIntoKeywords,
  uniqueStrings,
} from "./catalog-utils.js";
import {
  collectNpmMcpSearchQueriesFromDemandProfile,
  collectPackageCandidatesFromDemandProfile,
  type PackageRegistryKind,
} from "./package-candidates.js";

/**
 * Provides harvest package registry source for the lifecycle pipeline.
 */
export async function harvestPackageRegistrySource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): Promise<AssetCatalogEntry[]> {
  const registryKind = getPackageRegistryKind(source);
  const packageCandidates = new Set(
    collectPackageCandidatesFromDemandProfile(demandProfile, registryKind),
  );
  const entries: AssetCatalogEntry[] = [];

  if (source.id === "npm-registry") {
    for (const packageName of await searchNpmMcpServerPackages(demandProfile)) {
      packageCandidates.add(packageName);
    }
  }

  for (const packageName of [...packageCandidates].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (source.id === "npm-registry") {
      const npmMetadata = await fetchNpmPackageMetadata(packageName);
      if (!npmMetadata) {
        continue;
      }

      entries.push(
        buildPackageRegistryCatalogEntry(
          source,
          packageName,
          npmMetadata.description ?? packageName,
          extractRepositoryUrlFromNpmMetadata(npmMetadata),
          npmMetadata.lastUpdated,
          demandProfile,
          selectionRegistry,
          "npm",
          npmMetadata.keywords ?? [],
        ),
      );
      continue;
    }

    if (source.id === "pypi-registry") {
      const pypiMetadata = await fetchPypiPackageMetadata(packageName);
      if (!pypiMetadata) {
        continue;
      }

      entries.push(
        buildPackageRegistryCatalogEntry(
          source,
          packageName,
          pypiMetadata.info.summary ?? packageName,
          extractRepositoryUrlFromPypiMetadata(pypiMetadata),
          pypiMetadata.lastUpdated,
          demandProfile,
          selectionRegistry,
          "pypi",
        ),
      );
      continue;
    }

    entries.push(
      buildPackageRegistryCatalogEntry(
        source,
        packageName,
        `${packageName} package inferred from ${registryKind} dependency evidence`,
        buildPackageRegistryUrl(registryKind, packageName),
        undefined,
        demandProfile,
        selectionRegistry,
        registryKind,
      ),
    );
  }

  return entries;
}

/**
 * Maps a configured package-registry source to its registry family.
 */
export function getPackageRegistryKind(
  source: SourceDefinition,
): PackageRegistryKind {
  const registryKindBySourceId: Record<string, PackageRegistryKind> = {
    "cargo-registry": "cargo",
    "go-registry": "go",
    "maven-registry": "maven",
    "nuget-registry": "nuget",
    "rubygems-registry": "gem",
    "packagist-registry": "packagist",
    "swift-package-index": "swift",
  };
  return (
    registryKindBySourceId[source.id] ??
    (source.id === "pypi-registry" ? "pypi" : "npm")
  );
}

async function searchNpmMcpServerPackages(
  demandProfile: DemandProfile | null,
): Promise<string[]> {
  const queries = collectNpmMcpSearchQueriesFromDemandProfile(demandProfile);
  const packageNames = new Set<string>();

  for (const query of queries) {
    const results = await fetchNpmPackageSearch(query);
    for (const result of results) {
      if (
        isMcpServerPackage(result.name, result.description, result.keywords)
      ) {
        packageNames.add(result.name);
      }
    }
  }

  return [...packageNames].sort((left, right) => left.localeCompare(right));
}

function isMcpServerPackage(
  packageName: string,
  description?: string,
  keywords: string[] = [],
): boolean {
  const normalizedPackageName = packageName.toLowerCase();
  if (normalizedPackageName.startsWith("@modelcontextprotocol/server-")) {
    return true;
  }

  if (matchesExecutableMcpPackageName(normalizedPackageName)) {
    return true;
  }

  const normalizedSearchText = [description ?? "", ...keywords]
    .join(" ")
    .toLowerCase();
  const mentionsProtocol =
    /\bmcp\b/u.test(normalizedSearchText) ||
    normalizedSearchText.includes("model context protocol");
  return mentionsProtocol && /\bservers?\b/u.test(normalizedSearchText);
}

function matchesExecutableMcpPackageName(packageName: string): boolean {
  const nonExecutableQualifier =
    "(?:sdk|docs?|client|ts|typescript|js|javascript|py|python|go|java|kotlin|swift)";
  const mcpServerTokenPattern = new RegExp(
    `(?:^|[\\/_-])(?:mcp-server|server-mcp)(?:$|[\\/_-](?!${nonExecutableQualifier}(?:$|[\\/_-])))`,
    "u",
  );
  const mcpSuffixPattern = new RegExp(
    `(?:^|-)mcp(?:$|-(?!${nonExecutableQualifier}(?:$|-))server(?:$|-(?!${nonExecutableQualifier}(?:$|-))))`,
    "u",
  );
  const scopedMcpServerPattern = new RegExp(
    `(?:^|/)mcp[-_]server(?:$|[-_](?!${nonExecutableQualifier}(?:$|[-_])))`,
    "u",
  );

  return (
    mcpServerTokenPattern.test(packageName) ||
    mcpSuffixPattern.test(packageName) ||
    scopedMcpServerPattern.test(packageName)
  );
}

function buildPackageRegistryUrl(
  registryKind: PackageRegistryKind,
  packageName: string,
): string {
  switch (registryKind) {
    case "cargo":
      return `https://crates.io/crates/${encodeURIComponent(packageName)}`;
    case "go":
      return `https://pkg.go.dev/${packageName}`;
    case "maven":
      return `https://central.sonatype.com/search?q=${encodeURIComponent(packageName)}`;
    case "nuget":
      return `https://www.nuget.org/packages/${encodeURIComponent(packageName)}`;
    case "gem":
      return `https://rubygems.org/gems/${encodeURIComponent(packageName)}`;
    case "packagist":
      return `https://packagist.org/packages/${packageName}`;
    case "swift":
      return `https://swiftpackageindex.com/search?query=${encodeURIComponent(packageName)}`;
    case "npm":
      return `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`;
    case "pypi":
      return `https://pypi.org/project/${encodeURIComponent(packageName)}`;
  }
}

/**
 * Builds a catalog entry from package-registry metadata or indexed package names.
 */
export function buildPackageRegistryCatalogEntry(
  source: SourceDefinition,
  packageName: string,
  description: string,
  repositoryUrl: string | undefined,
  lastUpdated: string | undefined,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  registryKind: PackageRegistryKind,
  packageKeywords: string[] = [],
): AssetCatalogEntry {
  const capabilities = uniqueStrings([
    ...splitIntoKeywords(packageName),
    ...splitIntoKeywords(description),
    ...packageKeywords.flatMap((keyword) => splitIntoKeywords(keyword)),
    registryKind,
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
  const assetKind = isMcpServerPackage(
    packageName,
    description,
    packageKeywords,
  )
    ? ("mcp-server" satisfies AssetKind)
    : ("plugin" satisfies AssetKind);
  const hosts =
    assetKind === "mcp-server"
      ? (["shared"] satisfies HostTarget[])
      : source.hosts;
  const compatibilityMode =
    assetKind === "mcp-server"
      ? ("native" satisfies CompatibilityMode)
      : ("adaptable" satisfies CompatibilityMode);
  const packagePageUrl = buildPackageRegistryUrl(registryKind, packageName);
  const originUrl = repositoryUrl ?? packagePageUrl;

  return {
    id: buildCatalogId(`${source.id}:${registryKind}`, packageName),
    displayName: packageName,
    assetKind,
    hosts,
    compatibilityMode,
    source: {
      sourceId: source.id,
      authorityTier: source.authorityTier,
      sourceKind: source.kind,
      sourcePriority: source.priority,
      originUrl,
      publisher: source.publisher?.name ?? source.id,
      publisherVerified: source.publisher?.verified ?? false,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode,
        installMethod: `${registryKind}-metadata`,
      }),
      signals: buildTrustSignals({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode,
        installMethod: `${registryKind}-metadata`,
      }),
    },
    capabilities,
    install: {
      method: `${registryKind}-metadata`,
      nativeHosts: compatibilityMode === "native" ? hosts : undefined,
      adaptableHosts: compatibilityMode === "adaptable" ? hosts : undefined,
      manifestEntry: packageName,
    },
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: Boolean(repositoryUrl),
      lineCount: 1,
      rootPath: originUrl,
    },
    maintenance: {
      lastUpdated: lastUpdated ?? new Date(0).toISOString(),
      stars: 0,
      releaseCadence: `${registryKind}-metadata`,
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
      duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
      candidateRankHint: buildCandidateRankHint(source.authorityTier),
    },
    status: {
      cataloged: true,
      mirrorEligible: false,
      installEligible: false,
      activationEligible: false,
    },
  };
}
