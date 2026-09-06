import { fetchOfficialIndexPageContent } from "../../official-index.js";
import type {
  AssetCatalogEntry,
  AssetKind,
  AssetStatus,
  CompatibilityMode,
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../../types.js";
import { inferCompatibleHosts } from "../../host-adapters/compatibility-matrix.js";
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
  harvestReferenceItems,
  type HarvestedReferenceItem,
} from "./reference-harvesters.js";

/**
 * Provides harvest reference source for the lifecycle pipeline.
 */
export async function harvestReferenceSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): Promise<AssetCatalogEntry[]> {
  const harvestedItems = await harvestReferenceItems(source, demandProfile);
  if (harvestedItems.length > 0) {
    return harvestedItems.map((item) =>
      buildReferenceSourceCatalogEntry(
        source,
        demandProfile,
        selectionRegistry,
        {
          harvestedItem: item,
        },
      ),
    );
  }

  const originUrl = getReferenceSourceOriginUrl(source);
  const harvestedContent = await fetchOfficialIndexPageContent(originUrl);

  return [
    buildReferenceSourceCatalogEntry(source, demandProfile, selectionRegistry, {
      harvestedContent: harvestedContent ?? undefined,
      originUrl,
    }),
  ];
}

/**
 * Builds a reference-source catalog entry from harvested page content or item metadata.
 */
export function buildReferenceSourceCatalogEntry(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  options: {
    harvestedContent?: string;
    harvestedItem?: HarvestedReferenceItem;
    originUrl?: string;
  } = {},
): AssetCatalogEntry {
  const harvestedItem = options.harvestedItem;
  const originUrl =
    harvestedItem?.originUrl ??
    options.originUrl ??
    getReferenceSourceOriginUrl(source);
  const assetKind: AssetKind = harvestedItem?.assetKind ?? "reference-pack";
  const harvestedContent = harvestedItem?.summary ?? options.harvestedContent;
  // A registry/marketplace item is still a successfully harvested manifest even
  // when its optional summary is blank. Semantic evidence is stricter: an empty
  // summary must not masquerade as README/content evidence (#459).
  const wasHarvested =
    harvestedItem !== undefined || typeof options.harvestedContent === "string";
  const hasSemanticContent =
    typeof harvestedContent === "string" && harvestedContent.trim().length > 0;
  const displayName = harvestedItem?.displayName ?? source.name;
  const capabilities = uniqueStrings([
    ...splitIntoKeywords(source.name),
    ...splitIntoKeywords(source.id),
    ...splitIntoKeywords(displayName),
    ...splitIntoKeywords(harvestedContent ?? ""),
    ...(harvestedItem?.capabilities ?? []),
    source.kind,
    assetKind,
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
  const compatibilityMode: CompatibilityMode =
    harvestedItem?.compatibilityMode ??
    (wasHarvested
      ? "adaptable"
      : source.kind === "marketplace"
        ? "partial"
        : "reference-only");
  const installMethod =
    harvestedItem?.installMethod ??
    (wasHarvested ? `${source.kind}-summary` : `${source.kind}-reference`);
  const publisherName =
    harvestedItem?.publisherName ?? source.publisher?.name ?? source.id;
  const publisherVerified = harvestedItem
    ? harvestedItem.publisherVerified === true
    : (source.publisher?.verified ?? false);

  return {
    id: buildCatalogId(source.id, originUrl),
    displayName,
    assetKind,
    hosts: source.hosts,
    compatibilityMode,
    compatibleHosts: inferCompatibleHosts(assetKind, source.hosts),
    source: {
      sourceId: source.id,
      authorityTier: source.authorityTier,
      sourceKind: source.kind,
      sourcePriority: source.priority,
      originUrl,
      publisher: publisherName,
      publisherVerified,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified,
        compatibilityMode,
        installMethod,
      }),
      signals: uniqueStrings([
        ...buildTrustSignals({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified,
          compatibilityMode,
          installMethod,
        }),
        // Preserve any item-level trust signals (e.g. "oms-signed",
        // "oms-trust-anchor") that were harvested from the source payload.
        ...(harvestedItem?.trustSignals ?? []),
      ]),
    },
    capabilities,
    install: {
      method: installMethod,
      nativeHosts: compatibilityMode === "native" ? source.hosts : undefined,
      adaptableHosts:
        compatibilityMode === "adaptable" ? source.hosts : undefined,
      manifestEntry: harvestedItem?.manifestEntry ?? originUrl,
    },
    evidence: {
      manifestFound: wasHarvested,
      readmeFound: hasSemanticContent,
      examplesFound: false,
      docsLinked: true,
      lineCount: hasSemanticContent
        ? harvestedContent!.split(/\r?\n/u).length
        : 0,
      rootPath: originUrl,
      classification: buildClassificationConfidence({
        assetKind,
        evidence: [
          sourceFamilyEvidence(
            `inferred from ${source.kind} reference source family`,
          ),
        ],
      }),
    },
    maintenance: {
      lastUpdated: harvestedItem?.lastUpdated ?? new Date().toISOString(),
      stars: harvestedItem?.installs ?? 0,
      releaseCadence: "source-reference",
    },
    risk: buildRisk(false, false, false),
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: computePortfolioFit(capabilities, demandProfile),
      hostFit: computeHostFit(source.hosts, compatibilityMode),
    },
    dedupe: {
      duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
      candidateRankHint: buildCandidateRankHint(source.authorityTier),
    },
    status: buildReferenceAssetStatus(source, compatibilityMode, wasHarvested),
  };
}

function buildReferenceAssetStatus(
  source: SourceDefinition,
  compatibilityMode: CompatibilityMode,
  wasHarvested: boolean,
): AssetStatus {
  const policyAllowsInstall =
    wasHarvested && source.rules.allowMirror && source.rules.allowInstall;
  const installEligible = compatibilityMode === "native" && policyAllowsInstall;

  return {
    cataloged: true,
    mirrorEligible: wasHarvested && source.rules.allowMirror,
    installEligible,
    activationEligible: installEligible,
  };
}

function getReferenceSourceOriginUrl(source: SourceDefinition): string {
  return (
    source.endpoints.docsUrl ??
    source.endpoints.baseUrl ??
    source.endpoints.repo ??
    source.id
  );
}
