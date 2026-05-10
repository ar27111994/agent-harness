import { createHash } from "node:crypto";
import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  createContentHash,
  ensureCleanDirectory,
  ensureDirectory,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
  writeBinaryFile,
  writeJsonFile,
  writeJsonLinesFileWithSnapshot,
} from "../files.js";
import {
  buildGitHubRawFileUrl,
  fetchGitHubRepoSnapshotByRepoUrl,
} from "../github.js";
import { getOptionValue, getOptionValues } from "../lib/cli-options.js";
import { fetchBytesWithGuards, fetchJsonWithGuards } from "../lib/http.js";
import {
  isPathWithinRoot,
  resolveSafeMirrorFilePath,
} from "../lib/safe-paths.js";
import {
  assertAssetCatalogEntry,
  assertMirrorIndexEntry,
  assertMirrorPolicy,
} from "../manifest-validation.js";
import {
  fetchOfficialIndexPageContent,
  fetchOfficialIndexPageInfo,
  fetchOfficialIndexPageRepositoryUrl,
} from "../official-index.js";
import type {
  AssetCatalogEntry,
  MirrorAcquireState,
  MirrorIndexEntry,
  MirrorPolicy,
} from "../types.js";
import { resolveBundleLocks } from "./bundles.js";
import {
  GITHUB_API_ALLOWED_ORIGINS,
  GITHUB_RAW_ALLOWED_ORIGINS,
  getMaxGitHubMirrorFileSizeBytes,
  getMaxOfficialIndexFileSizeBytes,
  getMaxOfficialIndexPackageFiles,
  getMaxOfficialIndexPackageTotalBytes,
  MIRROR_ACQUIRE_STATE_OUTPUT_PATH,
  MIRROR_INDEX_OUTPUT_PATH,
  MIRROR_INDEX_SNAPSHOT_PATH,
} from "./constants.js";
import {
  buildMirrorEvidenceAllowedRoots,
  resolveAllowedMirrorEvidenceFilePathForRead,
  sanitizeMirrorId,
} from "./paths.js";

interface MaterializedMirrorArtifact {
  content: Buffer;
  files?: Array<{
    relativePath: string;
    content: Buffer;
    upstreamBlobSha?: string;
  }>;
  upstreamRef?: string;
  upstreamCommit?: string;
  upstreamBlobSha?: string;
}

interface MirrorFileManifest {
  schemaVersion: 1;
  aggregateHash: string;
  files: Array<{
    relativePath: string;
    sha256: string;
    sizeBytes: number;
    upstreamBlobSha?: string;
  }>;
}

type MirrorAcquireSkipReason =
  | "materialize-failed"
  | "official-index-package-too-many-files"
  | "official-index-file-too-large"
  | "official-index-package-too-large";

interface MaterializeArtifactResult {
  artifact: MaterializedMirrorArtifact | null;
  skipReason?: MirrorAcquireSkipReason;
}

interface PersistedSkippedAssets {
  assetIds: Set<string>;
  assetReasons: Map<string, string>;
}

interface AcquireMirrorArtifactsDependencies {
  materializeArtifact?: (
    entry: AssetCatalogEntry,
    projectRoot: string,
    requirePinnedProvenance: boolean,
    evidenceAllowedRoots: readonly string[],
  ) => Promise<MaterializeArtifactResult>;
}

const officialIndexRepoUrlCache = new Map<string, string | null>();

/**
 * Provides acquire mirror artifacts for the lifecycle pipeline.
 */
export async function acquireMirrorArtifacts(
  projectRoot: string,
  workingDirectory: string,
  args: string[],
  dependencies: AcquireMirrorArtifactsDependencies = {},
): Promise<void> {
  const policy = await readJsonFile<MirrorPolicy>(
    join(projectRoot, "mirror", "policy.json"),
    assertMirrorPolicy,
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );
  const mirrorEligibleEntries = selectedEntries.filter(
    (entry) => entry.status.mirrorEligible,
  );
  const mirrorEligibleAssetIds = new Set(
    mirrorEligibleEntries.map((entry) => entry.id),
  );
  const refreshRequested = args.includes("--refresh");
  const refreshAssetIds = new Set(getOptionValues(args, "--asset"));
  const rawBatchSize = Number(
    getOptionValue(args, "--batch-size") ??
      getRuntimeConfig().batches.mirrorAcquire,
  );
  const batchSize =
    Number.isFinite(rawBatchSize) &&
    Number.isInteger(rawBatchSize) &&
    rawBatchSize >= 1
      ? rawBatchSize
      : 120;
  const existingMirrorIndexEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    assertMirrorIndexEntry,
  );
  const previouslySkippedAssets = await readPersistedSkippedAssets(projectRoot);
  const scopedSkippedAssetIds = new Set(
    [...previouslySkippedAssets.assetIds].filter((assetId) =>
      mirrorEligibleAssetIds.has(assetId),
    ),
  );
  const scopedSkippedAssetReasons = new Map(
    [...previouslySkippedAssets.assetReasons].filter(([assetId]) =>
      mirrorEligibleAssetIds.has(assetId),
    ),
  );
  const existingMirrorIdsByAssetId = new Map(
    existingMirrorIndexEntries.map((entry) => [entry.assetId, entry.mirrorId]),
  );
  const unresolvedEntries = mirrorEligibleEntries.filter((entry) => {
    const shouldRefreshEntry =
      refreshRequested || refreshAssetIds.has(entry.id);

    if (shouldRefreshEntry) {
      return true;
    }

    return (
      !existingMirrorIdsByAssetId.has(entry.id) &&
      !scopedSkippedAssetIds.has(entry.id)
    );
  });
  const entriesToAcquire = unresolvedEntries.slice(0, batchSize);
  const newMirrorIndexEntries: MirrorIndexEntry[] = [];
  const skippedAssetIds: string[] = [];
  const skippedAssetReasons = new Map<string, string>();
  const evidenceAllowedRoots = buildMirrorEvidenceAllowedRoots(
    projectRoot,
    workingDirectory,
  );
  const materializeArtifact =
    dependencies.materializeArtifact ?? materializeMirrorArtifact;

  for (const entry of entriesToAcquire) {
    const materializedArtifactResult = await materializeArtifact(
      entry,
      projectRoot,
      policy.selection.requirePinnedProvenance,
      evidenceAllowedRoots,
    );
    if (materializedArtifactResult.artifact === null) {
      skippedAssetIds.push(entry.id);
      skippedAssetReasons.set(
        entry.id,
        materializedArtifactResult.skipReason ?? "materialize-failed",
      );
      continue;
    }

    const materializedArtifact = materializedArtifactResult.artifact;
    const fileManifest = buildMirrorFileManifest(materializedArtifact, entry);
    const mirrorId = `sha256-${createContentHash(`${entry.id}\n${fileManifest.aggregateHash}`)}`;
    const rawRoot = join(
      projectRoot,
      "mirror",
      "raw",
      sanitizeMirrorId(mirrorId),
    );
    await ensureCleanDirectory(rawRoot);
    await writeBinaryFile(
      join(rawRoot, "content.txt"),
      materializedArtifact.content,
    );

    for (const file of materializedArtifact.files ?? []) {
      await writeBinaryFile(
        resolveSafeMirrorFilePath(rawRoot, file.relativePath),
        file.content,
      );
    }

    await writeJsonFile(join(rawRoot, "manifest.json"), fileManifest);
    await writeJsonFile(join(rawRoot, "asset.json"), entry);

    const mirrorIndexEntry: MirrorIndexEntry = {
      mirrorId,
      assetId: entry.id,
      upstream: buildUpstreamMetadata(entry, materializedArtifact),
      source: {
        authorityTier: entry.source.authorityTier,
        publisher: entry.source.publisher,
        publisherVerified: entry.source.publisherVerified,
      },
      mirroredAt: new Date().toISOString(),
      contentHash: fileManifest.aggregateHash,
      projectionCandidates: entry.hosts.map((host) => ({
        host,
        projectionType:
          entry.compatibilityMode === "native"
            ? `native-${entry.assetKind}`
            : `adapted-${entry.assetKind}`,
      })),
      status: determineMirrorStatus(entry, materializedArtifact),
    };

    if (
      mirrorIndexEntry.status === "approved-with-warning" ||
      mirrorIndexEntry.status === "quarantined"
    ) {
      const quarantineRoot = join(
        projectRoot,
        "mirror",
        "quarantine",
        sanitizeMirrorId(mirrorId),
      );
      await ensureDirectory(quarantineRoot);
      await writeBinaryFile(
        join(quarantineRoot, "content.txt"),
        materializedArtifact.content,
      );
      await writeJsonFile(join(quarantineRoot, "asset.json"), entry);
    }

    newMirrorIndexEntries.push(mirrorIndexEntry);
  }

  const mergedMirrorIndexEntries = mergeMirrorIndexEntries(
    existingMirrorIndexEntries,
    newMirrorIndexEntries,
  );
  await writeJsonLinesFileWithSnapshot(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    join(projectRoot, ...MIRROR_INDEX_SNAPSHOT_PATH),
    mergedMirrorIndexEntries,
  );
  await resolveBundleLocks(
    projectRoot,
    mergedMirrorIndexEntries,
    policy.bundleTemplates.map((template) => template.id),
  );

  const mirroredAssetIds = new Set(
    mergedMirrorIndexEntries.map((mirrorEntry) => mirrorEntry.assetId),
  );
  const cumulativeSkippedAssetIds = new Set([
    ...scopedSkippedAssetIds,
    ...skippedAssetIds,
  ]);
  const cumulativeSkippedAssetReasons = new Map(scopedSkippedAssetReasons);
  for (const [assetId, reason] of skippedAssetReasons) {
    cumulativeSkippedAssetReasons.set(assetId, reason);
  }
  const effectiveSkippedAssetIds = new Set(
    [...cumulativeSkippedAssetIds].filter(
      (assetId) => !mirroredAssetIds.has(assetId),
    ),
  );
  const effectiveSkippedAssetReasons = new Map(
    [...cumulativeSkippedAssetReasons].filter(([assetId]) =>
      effectiveSkippedAssetIds.has(assetId),
    ),
  );
  const totalMirroredCount = mirrorEligibleEntries.filter((entry) =>
    mirroredAssetIds.has(entry.id),
  ).length;
  const totalSkippedCount = effectiveSkippedAssetIds.size;
  const actualRemainingCount = Math.max(
    0,
    mirrorEligibleEntries.length - totalMirroredCount - totalSkippedCount,
  );
  const isTerminal = actualRemainingCount <= 0;

  await writeMirrorAcquireState(projectRoot, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize,
    totalEligibleCount: mirrorEligibleEntries.length,
    mirroredCount: totalMirroredCount,
    remainingCount: actualRemainingCount,
    skippedCount: totalSkippedCount,
    skippedAssetIds: [...effectiveSkippedAssetIds].sort(),
    skippedAssetReasons: buildSortedReasonRecord(effectiveSkippedAssetReasons),
    lastBatchAssetIds: entriesToAcquire.map((entry) => entry.id),
    lastBatchMirroredCount: newMirrorIndexEntries.length,
    lastBatchSkippedCount: skippedAssetIds.length,
    lastBatchSkippedReasons: buildSortedReasonRecord(skippedAssetReasons),
    terminal: isTerminal,
  });

  if (isTerminal && totalMirroredCount === mirrorEligibleEntries.length) {
    console.log(
      `Mirror acquire complete: ${totalMirroredCount}/${mirrorEligibleEntries.length} artifacts under ${toPosixPath(join(projectRoot, "mirror"))}`,
    );
  } else if (isTerminal) {
    console.log(
      `Mirror acquire terminal: ${totalMirroredCount} mirrored, ${totalSkippedCount} skipped (unmirrorable) of ${mirrorEligibleEntries.length} eligible`,
    );
  } else {
    console.log(
      `Mirror acquire batch: ${newMirrorIndexEntries.length} mirrored, ${skippedAssetIds.length} skipped this batch (${totalMirroredCount}/${mirrorEligibleEntries.length} mirrored, ${totalSkippedCount} skipped total, ${actualRemainingCount} remaining)`,
    );
  }
}

async function materializeMirrorArtifact(
  entry: AssetCatalogEntry,
  projectRoot: string,
  requirePinnedProvenance: boolean,
  evidenceAllowedRoots: readonly string[],
): Promise<MaterializeArtifactResult> {
  if (entry.install.method.endsWith("-summary")) {
    const referenceContent = await fetchOfficialIndexPageContent(
      entry.source.originUrl,
    );
    if (referenceContent !== null) {
      return {
        artifact: {
          content: Buffer.from(referenceContent, "utf8"),
        },
      };
    }
  }

  if (entry.install.method === "github-tree-metadata") {
    return materializeGitHubTreeArtifact(entry, requirePinnedProvenance);
  }

  if (entry.install.method === "official-index-entry") {
    return materializeOfficialIndexPackage(entry, projectRoot);
  }

  const filePath = entry.evidence.filePath;
  if (filePath) {
    const safeFilePath = await resolveAllowedMirrorEvidenceFilePathForRead(
      filePath,
      evidenceAllowedRoots,
    );
    if (!safeFilePath) {
      throw new Error(
        `Refusing to read evidence file outside allowed roots: ${filePath}`,
      );
    }

    const fileContent = await readTextFileOrNull(safeFilePath);
    if (fileContent !== null) {
      return {
        artifact: {
          content: Buffer.from(fileContent, "utf8"),
        },
      };
    }
  }

  const cachePath = buildGitHubCachePath(entry, projectRoot);
  if (cachePath && !isPathWithinRoot(projectRoot, cachePath)) {
    throw new Error(`Refusing to read cache file outside project root: ${cachePath}`);
  }

  if (cachePath && (await pathLooksReadable(cachePath))) {
    const cacheContent = await readTextFileOrNull(cachePath);
    if (cacheContent !== null) {
      return {
        artifact: {
          content: Buffer.from(cacheContent, "utf8"),
        },
      };
    }
  }

  return {
    artifact: {
      content: Buffer.from(JSON.stringify(entry, null, 2), "utf8"),
    },
  };
}

async function materializeGitHubTreeArtifact(
  entry: AssetCatalogEntry,
  requirePinnedProvenance: boolean,
): Promise<MaterializeArtifactResult> {
  const repoInfo = parseGitHubBlobEntry(entry);
  if (!repoInfo) {
    return requirePinnedProvenance
      ? { artifact: null }
      : {
          artifact: {
            content: Buffer.from(JSON.stringify(entry, null, 2), "utf8"),
          },
        };
  }

  if (!repoInfo.expectedBlobSha) {
    return { artifact: null };
  }

  const commitSha = await fetchGitHubBranchCommitSha(
    repoInfo.owner,
    repoInfo.repo,
    repoInfo.ref,
  );
  const fetchRef = commitSha ?? repoInfo.ref;
  const content = await fetchVerifiedGitHubFileContent(
    repoInfo.owner,
    repoInfo.repo,
    fetchRef,
    repoInfo.filePath,
    getMaxGitHubMirrorFileSizeBytes(),
    repoInfo.expectedBlobSha,
  );
  if (content === null) {
    return { artifact: null };
  }

  return {
    artifact: {
      content,
      upstreamRef: repoInfo.ref,
      upstreamCommit: commitSha ?? undefined,
      upstreamBlobSha: repoInfo.expectedBlobSha,
    },
  };
}

async function materializeOfficialIndexPackage(
  entry: AssetCatalogEntry,
  projectRoot: string,
): Promise<MaterializeArtifactResult> {
  const slug = entry.install.manifestEntry;
  const owner = entry.source.sourceId.split(":")[1];
  let capSkipReason: MirrorAcquireSkipReason | undefined;
  let sawNonCapFailure = false;

  if (!slug || !owner) {
    return { artifact: null };
  }

  const officialIndexPage = await fetchOfficialIndexPageInfo(
    entry.source.originUrl,
  );
  officialIndexRepoUrlCache.set(
    entry.source.originUrl,
    officialIndexPage.repositoryUrl,
  );

  for (const repoUrl of await buildOfficialIndexRepoUrlCandidates(
    entry,
    owner,
    officialIndexPage.repositoryUrl,
  )) {
    const snapshot = await fetchGitHubRepoSnapshotByRepoUrl({
      repoUrl,
      projectRoot,
      sourceId: entry.source.sourceId,
    });

    if (!snapshot || snapshot.tree.truncated) {
      sawNonCapFailure = true;
      continue;
    }

    const skillRootPath = findOfficialIndexSkillRoot(
      snapshot.tree.entries,
      slug,
    );
    if (!skillRootPath) {
      sawNonCapFailure = true;
      continue;
    }

    const packageFileCandidates = snapshot.tree.entries.filter(
      (treeEntry) =>
        treeEntry.type === "blob" &&
        treeEntry.path.startsWith(`${skillRootPath}/`),
    );
    const packageTotalBytes = packageFileCandidates.reduce(
      (totalBytes, treeEntry) => totalBytes + Math.max(0, treeEntry.size ?? 0),
      0,
    );
    if (
      packageFileCandidates.length > getMaxOfficialIndexPackageFiles()
    ) {
      capSkipReason ??= "official-index-package-too-many-files";
      continue;
    }

    if (
      packageFileCandidates.some(
        (treeEntry) =>
          treeEntry.size !== null &&
          treeEntry.size > getMaxOfficialIndexFileSizeBytes(),
      )
    ) {
      capSkipReason ??= "official-index-file-too-large";
      continue;
    }

    if (packageTotalBytes > getMaxOfficialIndexPackageTotalBytes()) {
      capSkipReason ??= "official-index-package-too-large";
      continue;
    }

    const packageFiles = packageFileCandidates;

    if (packageFiles.length === 0) {
      sawNonCapFailure = true;
      continue;
    }

    const commitSha = await fetchGitHubBranchCommitSha(
      snapshot.owner,
      snapshot.repo,
      snapshot.repoSummary.defaultBranch,
    );

    const materializedFiles: Array<{
      relativePath: string;
      content: Buffer;
      upstreamBlobSha?: string;
    }> = [];
    const fetchRef = commitSha ?? snapshot.repoSummary.defaultBranch;

    for (const packageFile of packageFiles) {
      const fileContent = await fetchVerifiedGitHubFileContent(
        snapshot.owner,
        snapshot.repo,
        fetchRef,
        packageFile.path,
        getMaxOfficialIndexFileSizeBytes(),
        packageFile.sha,
      );
      if (fileContent === null) {
        materializedFiles.length = 0;
        break;
      }

      materializedFiles.push({
        relativePath: packageFile.path.slice(skillRootPath.length + 1),
        content: fileContent,
        upstreamBlobSha: packageFile.sha,
      });
    }

    if (materializedFiles.length === 0) {
      sawNonCapFailure = true;
      continue;
    }

    const skillMarkdownFile = materializedFiles.find(
      (file) => file.relativePath === "SKILL.md",
    );

    return {
      artifact: {
        content:
          skillMarkdownFile?.content ??
          Buffer.from(JSON.stringify(entry, null, 2), "utf8"),
        files: materializedFiles,
        upstreamRef: snapshot.repoSummary.defaultBranch,
        upstreamCommit: commitSha ?? undefined,
      },
    };
  }

  if (sawNonCapFailure && officialIndexPage.content !== null) {
    return {
      artifact: {
        content: Buffer.from(officialIndexPage.content, "utf8"),
      },
    };
  }

  return {
    artifact: null,
    skipReason: sawNonCapFailure ? undefined : capSkipReason,
  };
}

async function buildOfficialIndexRepoUrlCandidates(
  entry: AssetCatalogEntry,
  owner: string,
  resolvedOfficialIndexRepoUrl?: string | null,
): Promise<string[]> {
  let officialIndexRepoUrl =
    resolvedOfficialIndexRepoUrl ??
    officialIndexRepoUrlCache.get(entry.source.originUrl);

  if (
    resolvedOfficialIndexRepoUrl === undefined &&
    !officialIndexRepoUrlCache.has(entry.source.originUrl)
  ) {
    officialIndexRepoUrl = await fetchOfficialIndexPageRepositoryUrl(
      entry.source.originUrl,
    );
    officialIndexRepoUrlCache.set(entry.source.originUrl, officialIndexRepoUrl);
  }

  const candidateRepoUrls = [
    officialIndexRepoUrl,
    entry.evidence.rootPath,
    `https://github.com/${owner}/${owner}-skills`,
    `https://github.com/${owner}/skills`,
  ].filter(
    (value): value is string =>
      typeof value === "string" && isGitHubHttpsRepositoryUrl(value),
  );

  return [...new Set(candidateRepoUrls)];
}

function isGitHubHttpsRepositoryUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return (
      parsedUrl.protocol === "https:" &&
      parsedUrl.hostname.toLowerCase() === "github.com" &&
      parsedUrl.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

function isGitHubHttpsUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return (
      parsedUrl.protocol === "https:" &&
      parsedUrl.hostname.toLowerCase() === "github.com"
    );
  } catch {
    return false;
  }
}

function findOfficialIndexSkillRoot(
  treeEntries: Array<{
    path: string;
    type: string;
    size: number | null;
    sha: string;
  }>,
  slug: string,
): string | null {
  const skillMarkdownPath = treeEntries
    .filter(
      (treeEntry) =>
        treeEntry.type === "blob" && treeEntry.path.endsWith("/SKILL.md"),
    )
    .map((treeEntry) => treeEntry.path)
    .filter((path) => path.includes(`/${slug}/`) || path.startsWith(`${slug}/`))
    .sort((left, right) => left.length - right.length)[0];

  return skillMarkdownPath
    ? skillMarkdownPath.slice(0, -"/SKILL.md".length)
    : null;
}

async function fetchVerifiedGitHubFileContent(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  maxBytes: number,
  expectedBlobSha?: string,
): Promise<Buffer | null> {
  const content = await fetchBytesWithGuards(
    buildGitHubRawFileUrl({ owner, repo, branch, filePath }),
    {
      allowedOrigins: GITHUB_RAW_ALLOWED_ORIGINS,
      headers: buildGitHubHeaders(),
      maxBytes,
    },
  );

  if (content === null) {
    return null;
  }

  if (expectedBlobSha && createGitBlobSha(content) !== expectedBlobSha) {
    return null;
  }

  return content;
}

async function fetchGitHubBranchCommitSha(
  owner: string,
  repo: string,
  ref: string,
): Promise<string | null> {
  const commitData = await fetchJsonWithGuards(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
    {
      allowedOrigins: GITHUB_API_ALLOWED_ORIGINS,
      headers: buildGitHubHeaders({ accept: "application/vnd.github+json" }),
      maxBytes: 500_000,
    },
  );

  if (
    typeof commitData === "object" &&
    commitData !== null &&
    !Array.isArray(commitData) &&
    typeof (commitData as Record<string, unknown>).sha === "string"
  ) {
    return (commitData as Record<string, string>).sha;
  }

  return null;
}

function parseGitHubBlobEntry(entry: AssetCatalogEntry): {
  owner: string;
  repo: string;
  ref: string;
  filePath: string;
  expectedBlobSha?: string;
} | null {
  const filePath = entry.evidence.filePath;
  if (!filePath) {
    return null;
  }

  try {
    const url = new URL(entry.source.originUrl);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length < 5 || pathParts[2] !== "blob") {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1].replace(/\.git$/u, "");
    const blobPath = pathParts.slice(3).join("/");
    if (!blobPath.endsWith(filePath)) {
      return null;
    }

    const ref = blobPath.slice(0, -filePath.length).replace(/\/$/u, "");
    if (!owner || !repo || !ref) {
      return null;
    }

    const expectedBlobSha = isGitBlobSha(entry.install.manifestEntry)
      ? entry.install.manifestEntry
      : undefined;

    return { owner, repo, ref, filePath, expectedBlobSha };
  } catch {
    return null;
  }
}

function buildMirrorFileManifest(
  materializedArtifact: MaterializedMirrorArtifact,
  entry: AssetCatalogEntry,
): MirrorFileManifest {
  const files = [
    { relativePath: "content.txt", content: materializedArtifact.content },
    {
      relativePath: "asset.json",
      content: Buffer.from(`${JSON.stringify(entry, null, 2)}\n`, "utf8"),
    },
    ...(materializedArtifact.files ?? []),
  ]
    .map((file) => ({
      relativePath: file.relativePath,
      sha256: createContentHash(file.content),
      sizeBytes: file.content.byteLength,
      upstreamBlobSha: file.upstreamBlobSha,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const aggregateHash = createContentHash(
    files
      .map((file) =>
        [
          file.relativePath,
          file.sha256,
          String(file.sizeBytes),
          file.upstreamBlobSha ?? "",
        ].join("\0"),
      )
      .join("\n"),
  );

  return {
    schemaVersion: 1,
    aggregateHash,
    files,
  };
}

function buildGitHubHeaders(options: { accept?: string } = {}): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": "agent-harness",
  };
  if (options.accept) {
    headers.Accept = options.accept;
  }

  const githubToken = getRuntimeConfig().github.token;
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  return headers;
}

function buildUpstreamMetadata(
  entry: AssetCatalogEntry,
  materializedArtifact: MaterializedMirrorArtifact,
): MirrorIndexEntry["upstream"] {
  if (entry.source.originUrl.startsWith("file:///")) {
    return {
      type: "local",
      url: entry.source.originUrl,
    };
  }

  if (isGitHubHttpsUrl(entry.source.originUrl)) {
    return {
      type: "repo",
      url: entry.source.originUrl,
      ref: materializedArtifact.upstreamRef,
      commit: materializedArtifact.upstreamCommit,
    };
  }

  return {
    type: "docs",
    url: entry.source.originUrl,
  };
}

function determineMirrorStatus(
  entry: AssetCatalogEntry,
  materializedArtifact: MaterializedMirrorArtifact,
): MirrorIndexEntry["status"] {
  if (
    hasPromptInjectionRisk(materializedArtifact) &&
    entry.source.authorityTier !== "official-first-party"
  ) {
    return "quarantined";
  }

  if (hasPromptInjectionRisk(materializedArtifact)) {
    return "approved-with-warning";
  }

  if (
    entry.risk.level === "high" &&
    entry.source.authorityTier !== "official-first-party"
  ) {
    return "quarantined";
  }

  if (entry.risk.level === "high") {
    return "approved-with-warning";
  }

  if (entry.compatibilityMode === "reference-only") {
    return "reference-only";
  }

  return "approved";
}

function hasPromptInjectionRisk(
  materializedArtifact: MaterializedMirrorArtifact,
): boolean {
  const combinedContent = [
    materializedArtifact.content.toString("utf8"),
    ...(materializedArtifact.files ?? []).map((file) =>
      file.content.toString("utf8"),
    ),
  ].join("\n");
  const normalizedContent = normalizePromptInjectionText(combinedContent);
  return PROMPT_INJECTION_PATTERNS.some((pattern) =>
    pattern.test(normalizedContent),
  );
}

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:system\s+)?(?:instructions?|messages?|prompts?|rules?)\b/u,
  /\b(?:override|bypass|disable|discard)\s+(?:the\s+)?(?:system|developer|safety|security)\s+(?:instructions?|messages?|prompts?|rules?)\b/u,
  /\b(?:reveal|print|show|dump|output|leak)\s+(?:the\s+)?(?:system\s+prompt|developer\s+message|hidden\s+instructions?)\b/u,
  /\b(?:exfiltrate|steal|leak|dump|print|send|upload|post|output)\s+(?:secrets?|credentials?|tokens?|api\s*keys?|environment\s+variables|env(?:ironment)?\s*(?:vars?)?)\b/u,
  /\b(?:send|upload|post)\s+(?:.*\s+)?(?:to\s+)?(?:an?\s+)?(?:external|remote|attacker|webhook)\s+(?:server|url|endpoint)\b/u,
  /\b(?:do\s+not|don't)\s+(?:tell|mention|disclose)\s+(?:the\s+)?user\b/u,
];

function normalizePromptInjectionText(content: string): string {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`*_~>#|[\]{}()\\-]+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function createGitBlobSha(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function isGitBlobSha(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{40}$/iu.test(value));
}

async function readPersistedSkippedAssets(
  projectRoot: string,
): Promise<PersistedSkippedAssets> {
  const state = await readJsonFileOrNull<{
    skippedAssetIds?: unknown;
    skippedAssetReasons?: unknown;
  }>(join(projectRoot, ...MIRROR_ACQUIRE_STATE_OUTPUT_PATH));

  if (!state || !Array.isArray(state.skippedAssetIds)) {
    return {
      assetIds: new Set(),
      assetReasons: new Map(),
    };
  }

  const assetIds = new Set(
    state.skippedAssetIds.filter(
      (value): value is string => typeof value === "string",
    ),
  );
  const assetReasons = new Map<string, string>();
  if (
    typeof state.skippedAssetReasons === "object" &&
    state.skippedAssetReasons !== null &&
    !Array.isArray(state.skippedAssetReasons)
  ) {
    for (const [assetId, reason] of Object.entries(state.skippedAssetReasons)) {
      if (typeof reason === "string" && assetIds.has(assetId)) {
        assetReasons.set(assetId, reason);
      }
    }
  }

  return {
    assetIds,
    assetReasons,
  };
}

function buildSortedReasonRecord(
  reasons: Map<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    [...reasons.entries()].sort(([leftAssetId], [rightAssetId]) =>
      leftAssetId.localeCompare(rightAssetId),
    ),
  );
}

async function writeMirrorAcquireState(
  projectRoot: string,
  state: MirrorAcquireState,
): Promise<void> {
  await writeJsonFile(
    join(projectRoot, ...MIRROR_ACQUIRE_STATE_OUTPUT_PATH),
    state,
  );
}

function mergeMirrorIndexEntries(
  existingEntries: MirrorIndexEntry[],
  newEntries: MirrorIndexEntry[],
): MirrorIndexEntry[] {
  const byAssetId = new Map(
    existingEntries.map((entry) => [entry.assetId, entry]),
  );
  for (const entry of newEntries) {
    byAssetId.set(entry.assetId, entry);
  }

  return [...byAssetId.values()].sort((left, right) =>
    left.assetId.localeCompare(right.assetId),
  );
}

function buildGitHubCachePath(
  entry: AssetCatalogEntry,
  projectRoot: string,
): string | null {
  if (
    !entry.source.sourceId ||
    !isGitHubHttpsUrl(entry.source.originUrl)
  ) {
    return null;
  }

  const sourceCacheNames: Record<string, string> = {
    "github-awesome-copilot": "github__awesome-copilot.json",
    "supabase-agent-skills": "supabase__agent-skills.json",
  };

  const cacheFileName = sourceCacheNames[entry.source.sourceId];
  if (!cacheFileName) {
    return null;
  }

  return join(projectRoot, "state", "remote-cache", "github", cacheFileName);
}

async function pathLooksReadable(filePath: string): Promise<boolean> {
  return readTextFileOrNull(filePath)
    .then((content) => content !== null)
    .catch(() => false);
}
