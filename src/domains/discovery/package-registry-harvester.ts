import {
  extractRepositoryUrlFromNpmMetadata,
  extractRepositoryUrlFromPypiMetadata,
  fetchNpmPackageMetadata,
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
  collectPackageCandidatesFromDemandProfile,
  type PackageRegistryKind,
} from "./package-candidates.js";

export async function harvestPackageRegistrySource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): Promise<AssetCatalogEntry[]> {
  const registryKind = getPackageRegistryKind(source);
  const packageCandidates = collectPackageCandidatesFromDemandProfile(
    demandProfile,
    registryKind,
  );
  const entries: AssetCatalogEntry[] = [];

  for (const packageName of packageCandidates) {
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
          demandProfile,
          selectionRegistry,
          "npm",
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
        demandProfile,
        selectionRegistry,
        registryKind,
      ),
    );
  }

  return entries;
}

function getPackageRegistryKind(source: SourceDefinition): PackageRegistryKind {
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

function buildPackageRegistryCatalogEntry(
  source: SourceDefinition,
  packageName: string,
  description: string,
  repositoryUrl: string | undefined,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  registryKind: PackageRegistryKind,
): AssetCatalogEntry {
  const capabilities = uniqueStrings([
    ...splitIntoKeywords(packageName),
    ...splitIntoKeywords(description),
    registryKind,
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
  const assetKind = packageName.includes("mcp")
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
      originUrl: repositoryUrl ?? source.endpoints.baseUrl,
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
      rootPath: repositoryUrl ?? source.endpoints.baseUrl,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
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
