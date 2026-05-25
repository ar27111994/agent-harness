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
  deriveDisplayNameFromPath,
  classifyContextCost,
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
  frontmatterEvidence,
  pathEvidence,
  schemaEvidence,
  sourceFamilyEvidence,
  type ClassificationConfidence,
  type ClassificationEvidenceItem,
} from "./classification-confidence.js";
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
  classification: ClassificationConfidence;
}

type ReadLocalTextFile = typeof readTextFileOrNull;

/**
 * Provides harvest local manifest source for the lifecycle pipeline.
 */
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
      displayName: deriveDisplayNameFromPath(manifestEntry),
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

/**
 * Provides harvest local directory source for the lifecycle pipeline.
 */
export async function harvestLocalDirectorySource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
  readLocalTextFile: ReadLocalTextFile = readTextFileOrNull,
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
      : new Set<string>();

  for (const filePath of files) {
    const relativePath = toRelativePosixPath(rootPath, filePath);
    const classification = classifyLocalDirectoryFile(source, relativePath);

    if (!classification) {
      continue;
    }

    if (source.id === "local-antigravity-skills") {
      const antigravitySkillKey = toAntigravityManifestEntry(relativePath);
      if (!antigravityManifestEntries.has(antigravitySkillKey)) {
        continue;
      }
    }

    const content = await readLocalTextFile(filePath);
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
        deriveDisplayNameFromPath(relativePath),
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
        classification: mergeFrontmatterClassificationEvidence(
          classification,
          metadata,
        ),
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

    return buildLocalClassification(source, "skill", "adaptable", [
      schemaEvidence("matched Antigravity SKILL.md manifest"),
    ]);
  }

  if (source.id === "local-opencode-config") {
    if (/^skills\/.+\/SKILL\.md$/iu.test(relativePath)) {
      return buildLocalClassification(source, "skill", "native", [
        schemaEvidence("matched OpenCode SKILL.md manifest"),
      ]);
    }

    if (/^agents?\/.+\.md$/iu.test(relativePath)) {
      return buildLocalClassification(source, "agent", "native", [
        sourceFamilyEvidence("matched OpenCode agent path"),
        pathEvidence("matched agent markdown file"),
      ]);
    }

    if (/^commands\/.+\.md$/iu.test(relativePath)) {
      return buildLocalClassification(source, "prompt-pack", "native", [
        sourceFamilyEvidence("matched OpenCode command path"),
        pathEvidence("matched command markdown file"),
      ]);
    }

    if (/^plugins?\/.+\.(ts|js|mts|cts)$/iu.test(relativePath)) {
      return buildLocalClassification(source, "plugin", "native", [
        sourceFamilyEvidence("matched OpenCode plugin path"),
        pathEvidence("matched executable plugin file"),
      ]);
    }

    return null;
  }

  if (source.id === "local-claude-code-config") {
    return classifyClaudeCodeConfigFile(source, relativePath);
  }

  if (source.id === "local-cursor-config") {
    return classifyCursorConfigFile(source, relativePath);
  }

  if (source.id === "local-opencode-context") {
    if (!relativePath.endsWith(".md")) {
      return null;
    }

    if (/\/workflows\//iu.test(`/${relativePath}`)) {
      return buildNativeLocalFile(source, "workflow");
    }

    return buildNativeLocalFile(source, "reference-pack");
  }

  return null;
}

function classifyClaudeCodeConfigFile(
  source: SourceDefinition,
  relativePath: string,
): ClassifiedLocalFile | null {
  if (/^CLAUDE(?:\.local)?\.md$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "instruction");
  }

  if (/^agents\/.+\.md$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "agent");
  }

  if (/^commands\/.+\.md$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "prompt-pack");
  }

  if (/^skills\/.+\/SKILL\.md$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "skill");
  }

  if (/^workflows\/.+\.(md|ya?ml|json)$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "workflow");
  }

  if (/^(?:hooks\/.+\.json|settings(?:\.local)?\.json)$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "hook");
  }

  if (
    /^(?:plugins\/.+\/\.claude-plugin\/plugin\.json|\.claude-plugin\/plugin\.json)$/iu.test(
      relativePath,
    )
  ) {
    return buildNativeLocalFile(source, "plugin");
  }

  if (/^(?:plugins\/.+\/)?\.mcp\.json$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "mcp-server");
  }

  if (/^(?:plugins\/.+\/)?README\.md$/iu.test(relativePath)) {
    return buildReferenceLocalFile(source);
  }

  return null;
}

function classifyCursorConfigFile(
  source: SourceDefinition,
  relativePath: string,
): ClassifiedLocalFile | null {
  if (/^(?:plugins\/.+\/)?rules\/.+\.(?:mdc|md)$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "instruction");
  }

  if (/^\.cursorrules$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "instruction");
  }

  if (/^(?:plugins\/.+\/)?agents\/.+\.md$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "agent");
  }

  if (/^(?:plugins\/.+\/)?commands\/.+\.md$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "prompt-pack");
  }

  if (/^(?:plugins\/.+\/)?skills\/.+\/SKILL\.md$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "skill");
  }

  if (/^(?:plugins\/.+\/)?hooks\/.+\.json$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "hook");
  }

  if (/^hooks\.json$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "hook");
  }

  if (/^(?:plugins\/.+\/)?mcp\.json$/iu.test(relativePath)) {
    return buildNativeLocalFile(source, "mcp-server");
  }

  if (
    /^(?:plugins\/.+\/)?\.cursor-plugin\/plugin\.json$/iu.test(relativePath)
  ) {
    return buildNativeLocalFile(source, "plugin");
  }

  if (/^\.cursor-plugin\/marketplace\.json$/iu.test(relativePath)) {
    return buildReferenceLocalFile(source);
  }

  return null;
}

function buildNativeLocalFile(
  source: SourceDefinition,
  assetKind: AssetKind,
): ClassifiedLocalFile {
  return buildLocalClassification(source, assetKind, "native", [
    sourceFamilyEvidence(`matched ${source.id} ${assetKind} classifier`),
  ]);
}

function buildReferenceLocalFile(
  source: SourceDefinition,
): ClassifiedLocalFile {
  return buildLocalClassification(source, "reference-pack", "reference-only", [
    pathEvidence("matched reference/documentation path"),
  ]);
}

function buildLocalClassification(
  source: SourceDefinition,
  assetKind: AssetKind,
  compatibilityMode: CompatibilityMode,
  evidence: ClassificationEvidenceItem[],
): ClassifiedLocalFile {
  return {
    assetKind,
    compatibilityMode,
    hosts: source.hosts,
    classification: buildClassificationConfidence({ assetKind, evidence }),
  };
}

function mergeFrontmatterClassificationEvidence(
  classification: ClassifiedLocalFile,
  metadata: ParsedMarkdownMetadata,
): ClassificationConfidence {
  if (!hasClassificationFrontmatter(metadata)) {
    return classification.classification;
  }

  return buildClassificationConfidence({
    assetKind: classification.assetKind,
    evidence: [
      frontmatterEvidence("frontmatter supplied classification metadata"),
      ...classification.classification.evidence,
    ],
  });
}

function hasClassificationFrontmatter(
  metadata: ParsedMarkdownMetadata,
): boolean {
  return ["type", "kind", "assetKind", "name", "description", "tags"].some(
    (field) => metadata.fields[field] !== undefined,
  );
}

function toAntigravityManifestEntry(relativePath: string): string {
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

  if (assetKind === "hook") {
    const hasHooks = true;
    const hasExecScripts = /"command"\s*:|\bcommand\s*:|\bscript\s*:/iu.test(
      content,
    );
    const requiresNetwork = /fetch\(|https?:\/\//iu.test(content);
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
  }

  if (assetKind === "mcp-server") {
    const hasHooks = false;
    const hasExecScripts = /"command"\s*:/iu.test(content);
    const requiresNetwork = /"url"\s*:|https?:\/\//iu.test(content);
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
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

/**
 * Exposes focused local-harvester helpers for deterministic tests.
 */
export const localHarvesterInternals = {
  classifyLocalDirectoryFile,
  resolveEndpointPath,
};
