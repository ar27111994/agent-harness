import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  listFilesRecursive,
  pathExists,
  readJsonFileOrNull,
  readTextFileOrNull,
  toPosixPath,
  toRelativePosixPath,
} from "../../files.js";
import { resolvePortablePath } from "../../lib/paths.js";
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
  buildRisk,
  buildTrustSignals,
  classifyContextCost,
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
import {
  extractMarkdownMetadata,
  getFirstStringField,
  type ParsedMarkdownMetadata,
} from "./markdown-metadata.js";

interface LocalManifestShape {
  updatedAt?: string;
  entries?: string[];
}

const antigravityManifestEntryCache = new Map<string, Set<string>>();

interface ClassifiedLocalFile {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  hosts: HostTarget[];
}

export async function harvestLocalManifestSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  if (source.id === "local-antigravity-manifest") {
    await loadAntigravityManifestEntrySet(projectRoot);
    return [];
  }

  const filePath = resolveEndpointPath(source.endpoints.file, projectRoot);
  const manifest = await readJsonFileOrNull<LocalManifestShape>(filePath);

  if (!manifest?.entries || manifest.entries.length === 0) {
    return [];
  }

  const fileStat = await stat(filePath);
  const updatedAt = manifest.updatedAt ?? fileStat.mtime.toISOString();
  const originUrl = pathToFileURL(filePath).toString();

  return manifest.entries.map((manifestEntry) => {
    const assetKind = classifyManifestEntryAssetKind(manifestEntry);
    const hosts =
      assetKind === "mcp-server"
        ? (["shared"] satisfies HostTarget[])
        : source.hosts;
    const compatibilityMode: CompatibilityMode =
      assetKind === "mcp-server" ? "native" : "adaptable";
    const capabilities = collectManifestCapabilities(manifestEntry);

    return {
      id: buildCatalogId(source.id, manifestEntry),
      displayName: humanizeSlug(lastPathSegment(manifestEntry)),
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
          installMethod: "manifest-entry",
        }),
        signals: buildTrustSignals({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode,
          installMethod: "manifest-entry",
        }),
      },
      capabilities,
      install: {
        method: "manifest-entry",
        adaptableHosts: hosts,
        manifestEntry,
      },
      evidence: {
        manifestFound: true,
        readmeFound: false,
        examplesFound: false,
        docsLinked: false,
        lineCount: 1,
        filePath: toPosixPath(filePath),
        rootPath: toPosixPath(dirname(filePath)),
      },
      maintenance: {
        lastUpdated: updatedAt,
        stars: 0,
        releaseCadence: "local-curated",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
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
      status: buildAssetStatus(source),
    };
  });
}

export async function harvestLocalDirectorySource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  const rootPath = resolveEndpointPath(source.endpoints.path, projectRoot);

  if (!(await pathExists(rootPath))) {
    return [];
  }

  const files = await listFilesRecursive(rootPath);
  const entries: AssetCatalogEntry[] = [];
  const antigravityManifestEntries =
    source.id === "local-antigravity-skills"
      ? await loadAntigravityManifestEntrySet(projectRoot)
      : null;

  for (const filePath of files) {
    const relativePath = toRelativePosixPath(rootPath, filePath);
    const classification = classifyLocalDirectoryFile(source, relativePath);

    if (!classification) {
      continue;
    }

    if (source.id === "local-antigravity-skills") {
      const antigravitySkillKey = toAntigravityManifestEntry(relativePath);
      if (
        !antigravitySkillKey ||
        !antigravityManifestEntries?.has(antigravitySkillKey)
      ) {
        continue;
      }
    }

    const content = await readTextFileOrNull(filePath);
    if (content === null) {
      continue;
    }

    const fileStat = await stat(filePath);
    const metadata = extractMarkdownMetadata(content);
    const capabilities = collectDirectoryCapabilities(relativePath, metadata);
    const risk = await determineRisk(
      source,
      classification.assetKind,
      filePath,
      content,
    );
    const sourceId =
      source.id === "local-antigravity-skills"
        ? "local-antigravity-manifest"
        : source.id;

    entries.push({
      id: buildCatalogId(sourceId, relativePath),
      displayName:
        getFirstStringField(metadata.fields.name) ??
        metadata.heading ??
        humanizeSlug(lastPathSegment(relativePath)),
      assetKind: classification.assetKind,
      hosts: classification.hosts,
      compatibilityMode: classification.compatibilityMode,
      source: {
        sourceId,
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        originUrl: pathToFileURL(filePath).toString(),
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
          installMethod: "local-file",
        }),
        signals: buildTrustSignals({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode: classification.compatibilityMode,
          installMethod: "local-file",
        }),
      },
      capabilities,
      install: {
        method: "local-file",
        nativeHosts:
          classification.compatibilityMode === "native"
            ? classification.hosts
            : undefined,
        adaptableHosts:
          classification.compatibilityMode === "adaptable"
            ? classification.hosts
            : undefined,
        relativePath,
        dependencies: metadata.dependencies,
        prerequisites:
          metadata.prerequisites.length > 0
            ? metadata.prerequisites
            : undefined,
      },
      evidence: {
        manifestFound: true,
        readmeFound: classification.assetKind === "skill",
        examplesFound: false,
        docsLinked: /https?:\/\//iu.test(content),
        frontmatterFound: Object.keys(metadata.fields).length > 0,
        lineCount: metadata.lineCount,
        dependencies: metadata.dependencies,
        filePath: toPosixPath(filePath),
        rootPath: toPosixPath(rootPath),
      },
      maintenance: {
        lastUpdated: fileStat.mtime.toISOString(),
        stars: 0,
        releaseCadence: "local",
      },
      risk,
      contextCost: classifyContextCost(metadata.lineCount),
      fit: {
        portfolioFit: computePortfolioFit(capabilities, demandProfile),
        hostFit: computeHostFit(
          classification.hosts,
          classification.compatibilityMode,
        ),
      },
      dedupe: {
        duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
        candidateRankHint: buildCandidateRankHint(source.authorityTier),
      },
      status: buildAssetStatus(source),
    });
  }

  return entries;
}

async function loadAntigravityManifestEntrySet(
  projectRoot: string,
): Promise<Set<string>> {
  const cachedEntries = antigravityManifestEntryCache.get(projectRoot);
  if (cachedEntries) {
    return cachedEntries;
  }

  const antigravityManifestPath = resolveEndpointPath(
    "~/.agents/skills/.antigravity-install-manifest.json",
    projectRoot,
  );
  const manifest = await readJsonFileOrNull<LocalManifestShape>(
    antigravityManifestPath,
  );

  const entries = new Set(
    (manifest?.entries ?? []).map((entry) => entry.toLowerCase()),
  );
  antigravityManifestEntryCache.set(projectRoot, entries);
  return entries;
}

function classifyManifestEntryAssetKind(manifestEntry: string): AssetKind {
  const normalizedEntry = manifestEntry.toLowerCase();

  if (normalizedEntry.includes("mcp")) {
    return "mcp-server";
  }

  if (normalizedEntry.includes("plugin")) {
    return "plugin";
  }

  if (normalizedEntry.includes("agent")) {
    return "agent";
  }

  return "skill";
}

function collectManifestCapabilities(manifestEntry: string): string[] {
  return uniqueStrings(splitIntoKeywords(manifestEntry));
}

function classifyLocalDirectoryFile(
  source: SourceDefinition,
  relativePath: string,
): ClassifiedLocalFile | null {
  if (source.id === "local-antigravity-skills") {
    if (!/^.+\/SKILL\.md$/iu.test(relativePath)) {
      return null;
    }

    return {
      assetKind: "skill",
      compatibilityMode: "adaptable",
      hosts: source.hosts,
    };
  }

  if (source.id === "local-opencode-config") {
    if (/^skills\/[^/]+\/SKILL\.md$/iu.test(relativePath)) {
      return {
        assetKind: "skill",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    if (/^agent\/.+\.md$/iu.test(relativePath)) {
      return {
        assetKind: "agent",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    if (/^plugin\/.+\.(ts|js|mts|cts)$/iu.test(relativePath)) {
      return {
        assetKind: "plugin",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    return null;
  }

  if (source.id === "local-opencode-context") {
    if (!relativePath.endsWith(".md")) {
      return null;
    }

    if (/\/workflows\//iu.test(`/${relativePath}`)) {
      return {
        assetKind: "workflow",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    return {
      assetKind: "reference-pack",
      compatibilityMode: "native",
      hosts: source.hosts,
    };
  }

  return null;
}

function toAntigravityManifestEntry(relativePath: string): string | null {
  if (!relativePath.endsWith("/SKILL.md")) {
    return null;
  }

  return relativePath.replace(/\/SKILL\.md$/u, "").toLowerCase();
}

function collectDirectoryCapabilities(
  relativePath: string,
  metadata: ParsedMarkdownMetadata,
): string[] {
  const pathTokens = splitIntoKeywords(relativePath);
  const headingTokens = metadata.heading
    ? splitIntoKeywords(metadata.heading)
    : [];
  const descriptionTokens = metadata.description
    ? splitIntoKeywords(metadata.description)
    : [];

  return uniqueStrings([
    ...metadata.tags,
    ...pathTokens,
    ...headingTokens,
    ...descriptionTokens,
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
}

async function determineRisk(
  source: SourceDefinition,
  assetKind: AssetKind,
  filePath: string,
  content: string,
): Promise<AssetRisk> {
  if (assetKind === "plugin") {
    const hasHooks = /\bevent\s*\(/u.test(content);
    const hasExecScripts = /await\s+\$`|\bspawn\(|\bexec\(/u.test(content);
    const requiresNetwork = /fetch\(|https?:\/\//iu.test(content);
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
  }

  if (assetKind === "skill") {
    const routerExists = await pathExists(join(dirname(filePath), "router.sh"));
    const scriptsDirectoryExists = await pathExists(
      join(dirname(filePath), "scripts"),
    );
    const hasHooks = /\bhooks?\s*:/iu.test(content);
    const hasExecScripts = routerExists || scriptsDirectoryExists;
    const requiresNetwork = /fetch\(|https?:\/\//iu.test(content);
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
  }

  if (assetKind === "agent") {
    const hasHooks = false;
    const hasExecScripts = false;
    const requiresNetwork = false;
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
  }

  if (source.id === "local-opencode-context") {
    return buildRisk(false, false, false);
  }

  return buildRisk(false, false, false);
}

function resolveEndpointPath(
  endpointValue: string | undefined,
  projectRoot: string,
): string {
  if (!endpointValue) {
    return projectRoot;
  }

  return resolvePortablePath(endpointValue, projectRoot);
}
