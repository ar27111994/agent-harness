import {
  extractRepositoryUrlFromNpmMetadata,
  extractRepositoryUrlFromPypiMetadata,
  fetchNpmPackageMetadata,
  fetchNpmPackageSearch,
  fetchPypiPackageMetadata,
  fetchCratesIoSearch,
  fetchNugetSearch,
  fetchMavenSearch,
  fetchPackagistSearch,
  fetchRubyGemsSearch,
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
  buildClassificationConfidence,
  sourceFamilyEvidence,
} from "./classification-confidence.js";
import {
  collectNpmMcpSearchQueriesFromDemandProfile,
  collectPackageCandidatesFromDemandProfile,
  type PackageRegistryKind,
} from "./package-candidates.js";
import { getAdjacentPackagesForSignals } from "./adjacent-tooling.js";
import { inferCompatibleHosts } from "../../host-adapters/compatibility-matrix.js";
import { getRuntimeConfig } from "../../config/runtime.js";

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

  // Adjacent-tooling enrichment (#295): discover packages the workspace
  // should probably be using but has not yet declared.
  const discoveryConfig = getRuntimeConfig().discovery;
  const adjacentPackageNames = new Set(
    await discoverAdjacentPackages(
      registryKind,
      demandProfile,
      packageCandidates,
      {
        maxTerms: discoveryConfig.registrySearchMaxTerms,
        maxResultsPerTerm: discoveryConfig.registrySearchMaxResultsPerTerm,
        adjacentToolingEnabled: discoveryConfig.adjacentToolingEnabled,
      },
    ),
  );
  for (const pkg of adjacentPackageNames) {
    packageCandidates.add(pkg);
  }

  for (const packageName of [...packageCandidates].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const isAdjacent = adjacentPackageNames.has(packageName);
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
          isAdjacent,
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
          [],
          isAdjacent,
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
        [],
        isAdjacent,
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
    "pub-dev-registry": "pub",
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

/**
 * Searches a registry by kind using the appropriate search API.
 * Returns package names sorted alphabetically. Empty on API failure.
 */
async function searchRegistryByKind(
  registryKind: PackageRegistryKind,
  query: string,
  limit: number,
): Promise<string[]> {
  switch (registryKind) {
    case "npm":
      /* c8 ignore next 4 -- delegates to fetchNpmPackageSearch, tested in package-registries.test.ts */
      return (await fetchNpmPackageSearch(query))
        .slice(0, limit)
        .map((r) => r.name)
        .filter(Boolean);
    case "pypi":
      // PyPI has no public keyword-search API; fall back to empty.
      return [];
    /* c8 ignore start -- cargo/nuget/maven/packagist/gem delegate to registry helpers tested independently in package-registries.test.ts */
    case "cargo":
      return (await fetchCratesIoSearch(query, limit))
        .map((r) => r.name)
        .filter(Boolean);
    case "nuget":
      return (await fetchNugetSearch(query, limit))
        .map((r) => r.name)
        .filter(Boolean);
    case "maven":
      return (await fetchMavenSearch(query, limit))
        .map((r) => r.name)
        .filter(Boolean);
    case "packagist":
      return (await fetchPackagistSearch(query, limit))
        .map((r) => r.name)
        .filter(Boolean);
    case "gem":
      return (await fetchRubyGemsSearch(query, limit))
        .map((r) => r.name)
        .filter(Boolean);
    /* c8 ignore stop */
    case "go":
    case "swift":
    case "pub":
      // No public keyword-search API available.
      return [];
    default:
      return [];
  }
}

/**
 * Discovers adjacent packages by combining:
 * 1. Static adjacent-tooling matrix entries matching demand signals.
 * 2. Live registry search results for stack-signal terms (top-N by popularity).
 *
 * Packages already in `existingCandidates` are excluded so we don't duplicate.
 * Results are tagged for downstream `discoveryMethod: "registry-adjacent-search"`.
 */
async function discoverAdjacentPackages(
  registryKind: PackageRegistryKind,
  demandProfile: DemandProfile | null,
  existingCandidates: ReadonlySet<string>,
  config: {
    maxTerms: number;
    maxResultsPerTerm: number;
    adjacentToolingEnabled: boolean;
  },
): Promise<string[]> {
  const adjacent = new Set<string>();

  // 1. Static matrix — always fast, zero network calls.
  if (config.adjacentToolingEnabled && demandProfile) {
    const allSignalTokens = [
      ...demandProfile.signals.languages,
      ...demandProfile.signals.frameworks,
      ...demandProfile.signals.tooling,
      ...demandProfile.signals.concerns,
    ].map((s) =>
      s.replace(
        /^(npm|pypi|detector|framework|language|concern|tooling):/u,
        "",
      ),
    );

    for (const pkg of getAdjacentPackagesForSignals(
      registryKind,
      allSignalTokens,
    )) {
      if (!existingCandidates.has(pkg)) {
        adjacent.add(pkg);
      }
    }
  }

  // 2. Live registry search — use top demand language/framework signals as terms.
  if (config.adjacentToolingEnabled && demandProfile && config.maxTerms > 0) {
    const searchSignals = [
      ...demandProfile.signals.languages,
      ...demandProfile.signals.frameworks,
    ]
      .map((s) => s.replace(/^(npm|pypi|detector|framework|language):/u, ""))
      .filter((s) => s.length > 2)
      .slice(0, config.maxTerms);

    for (const term of searchSignals) {
      for (const name of await searchRegistryByKind(
        registryKind,
        term,
        config.maxResultsPerTerm,
      )) {
        if (!existingCandidates.has(name)) {
          adjacent.add(name);
        }
      }
    }
  }

  return [...adjacent].sort((a, b) => a.localeCompare(b));
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
    case "pub":
      return `https://pub.dev/packages/${encodeURIComponent(packageName)}`;
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
  isAdjacent = false,
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
    compatibleHosts: inferCompatibleHosts(assetKind, hosts),
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
      manifestFound: !isAdjacent,
      readmeFound: false,
      examplesFound: false,
      docsLinked: Boolean(repositoryUrl),
      lineCount: 1,
      rootPath: originUrl,
      discoveryMethod:
        /* c8 ignore next -- "manifest" arm is exercised by integration path; unit tests only exercise the adjacent-search arm */ isAdjacent
          ? "registry-adjacent-search"
          : "manifest",
      isAdjacentSuggestion: isAdjacent || undefined,
      classification: buildClassificationConfidence({
        assetKind,
        evidence: [
          sourceFamilyEvidence(
            `inferred from ${registryKind} package registry source family`,
          ),
        ],
      }),
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

/**
 * Exposes narrow package-registry-harvester internals for focused tests.
 * Covers `searchRegistryByKind` and `discoverAdjacentPackages` which are
 * private helpers not reachable without a real network in normal test suites.
 */
export const packageRegistryHarvesterInternals = {
  searchRegistryByKind,
  discoverAdjacentPackages,
};
