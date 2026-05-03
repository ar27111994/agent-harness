import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  createContentHash,
  ensureCleanDirectory,
  ensureDirectory,
  readJsonFile,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
  writeJsonFile,
  writeJsonLinesFileWithSnapshot,
  writeTextFile,
} from "../files.js";
import {
  buildGitHubRawFileUrl,
  fetchGitHubRepoSnapshotByRepoUrl,
} from "../github.js";
import { getOptionValue } from "../lib/cli-options.js";
import { fetchJsonWithGuards, fetchTextWithGuards } from "../lib/http.js";
import {
  isPathWithinRoot,
  resolveSafeMirrorFilePath,
} from "../lib/safe-paths.js";
import {
  assertAssetCatalogEntry,
  assertMirrorIndexEntry,
  assertMirrorPolicy,
} from "../manifest-validation.js";
import { fetchOfficialIndexPageContent } from "../official-index.js";
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
  MAX_GITHUB_MIRROR_FILE_SIZE_BYTES,
  MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES,
  MAX_OFFICIAL_INDEX_PACKAGE_FILES,
  MIRROR_ACQUIRE_STATE_OUTPUT_PATH,
  MIRROR_INDEX_OUTPUT_PATH,
  MIRROR_INDEX_SNAPSHOT_PATH,
} from "./constants.js";
import {
  buildMirrorEvidenceAllowedRoots,
  resolveAllowedMirrorEvidenceFilePath,
  sanitizeMirrorId,
} from "./paths.js";

interface MaterializedMirrorArtifact {
  content: string;
  files?: Array<{
    relativePath: string;
    content: string;
  }>;
  upstreamRef?: string;
  upstreamCommit?: string;
}

interface MirrorFileManifest {
  schemaVersion: 1;
  aggregateHash: string;
  files: Array<{
    relativePath: string;
    sha256: string;
    sizeBytes: number;
  }>;
}

export async function acquireMirrorArtifacts(
  projectRoot: string,
  workingDirectory: string,
  args: string[],
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
    (entry) => entry.status.mirrorEligible && entry.status.installEligible,
  );
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
  const existingMirrorIdsByAssetId = new Map(
    existingMirrorIndexEntries.map((entry) => [entry.assetId, entry.mirrorId]),
  );
  const unresolvedEntries = mirrorEligibleEntries.filter(
    (entry) => !existingMirrorIdsByAssetId.has(entry.id),
  );
  const entriesToAcquire = unresolvedEntries.slice(0, batchSize);
  const newMirrorIndexEntries: MirrorIndexEntry[] = [];
  const evidenceAllowedRoots = buildMirrorEvidenceAllowedRoots(
    projectRoot,
    workingDirectory,
  );

  for (const entry of entriesToAcquire) {
    const materializedArtifact = await materializeMirrorArtifact(
      entry,
      projectRoot,
      policy.selection.requirePinnedProvenance,
      evidenceAllowedRoots,
    );
    if (materializedArtifact === null) {
      continue;
    }

    const fileManifest = buildMirrorFileManifest(materializedArtifact, entry);
    const mirrorId = `sha256-${createContentHash(`${entry.id}\n${fileManifest.aggregateHash}`)}`;
    const rawRoot = join(
      projectRoot,
      "mirror",
      "raw",
      sanitizeMirrorId(mirrorId),
    );
    await ensureCleanDirectory(rawRoot);
    await writeTextFile(
      join(rawRoot, "content.txt"),
      materializedArtifact.content,
    );

    for (const file of materializedArtifact.files ?? []) {
      await writeTextFile(
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
      await writeTextFile(
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
  await writeMirrorAcquireState(projectRoot, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize,
    totalEligibleCount: mirrorEligibleEntries.length,
    mirroredCount: mirrorEligibleEntries.filter((entry) =>
      mergedMirrorIndexEntries.some(
        (mirrorEntry) => mirrorEntry.assetId === entry.id,
      ),
    ).length,
    remainingCount: Math.max(
      0,
      unresolvedEntries.length - entriesToAcquire.length,
    ),
    lastBatchAssetIds: entriesToAcquire.map((entry) => entry.id),
  });

  console.log(
    `Mirror artifacts acquired under ${toPosixPath(join(projectRoot, "mirror"))}`,
  );
}

async function materializeMirrorArtifact(
  entry: AssetCatalogEntry,
  projectRoot: string,
  requirePinnedProvenance: boolean,
  evidenceAllowedRoots: readonly string[],
): Promise<MaterializedMirrorArtifact | null> {
  if (entry.install.method.endsWith("-summary")) {
    const referenceContent = await fetchOfficialIndexPageContent(
      entry.source.originUrl,
    );
    if (referenceContent !== null) {
      return {
        content: referenceContent,
      };
    }
  }

  if (entry.install.method === "github-tree-metadata") {
    return materializeGitHubTreeArtifact(entry, requirePinnedProvenance);
  }

  if (entry.install.method === "official-index-entry") {
    const officialIndexPackageArtifact = await materializeOfficialIndexPackage(
      entry,
      projectRoot,
      requirePinnedProvenance,
    );
    if (officialIndexPackageArtifact !== null) {
      return officialIndexPackageArtifact;
    }

    const officialIndexContent = await fetchOfficialIndexPageContent(
      entry.source.originUrl,
    );
    if (officialIndexContent !== null) {
      return {
        content: officialIndexContent,
      };
    }
  }

  const filePath = entry.evidence.filePath;
  if (filePath) {
    const safeFilePath = resolveAllowedMirrorEvidenceFilePath(
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
        content: fileContent,
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
        content: cacheContent,
      };
    }
  }

  return {
    content: JSON.stringify(entry, null, 2),
  };
}

async function materializeGitHubTreeArtifact(
  entry: AssetCatalogEntry,
  requirePinnedProvenance: boolean,
): Promise<MaterializedMirrorArtifact | null> {
  const repoInfo = parseGitHubBlobEntry(entry);
  if (!repoInfo) {
    return requirePinnedProvenance
      ? null
      : { content: JSON.stringify(entry, null, 2) };
  }

  const commitSha = await fetchGitHubBranchCommitSha(
    repoInfo.owner,
    repoInfo.repo,
    repoInfo.ref,
  );
  if (requirePinnedProvenance && !commitSha) {
    return null;
  }

  const fetchRef = commitSha ?? repoInfo.ref;
  const content = await fetchGitHubFileContent(
    repoInfo.owner,
    repoInfo.repo,
    fetchRef,
    repoInfo.filePath,
    MAX_GITHUB_MIRROR_FILE_SIZE_BYTES,
  );
  if (content === null) {
    return null;
  }

  return {
    content,
    upstreamRef: repoInfo.ref,
    upstreamCommit: commitSha ?? undefined,
  };
}

async function materializeOfficialIndexPackage(
  entry: AssetCatalogEntry,
  projectRoot: string,
  requirePinnedProvenance: boolean,
): Promise<MaterializedMirrorArtifact | null> {
  const slug = entry.install.manifestEntry;
  const owner = entry.source.sourceId.split(":")[1];

  if (!slug || !owner) {
    return null;
  }

  for (const repoUrl of buildOfficialIndexRepoUrlCandidates(entry, owner)) {
    const snapshot = await fetchGitHubRepoSnapshotByRepoUrl({
      repoUrl,
      projectRoot,
      sourceId: entry.source.sourceId,
    });

    if (!snapshot) {
      continue;
    }

    const skillRootPath = findOfficialIndexSkillRoot(
      snapshot.tree.entries,
      slug,
    );
    if (!skillRootPath) {
      continue;
    }

    const packageFiles = snapshot.tree.entries
      .filter(
        (treeEntry) =>
          treeEntry.type === "blob" &&
          treeEntry.path.startsWith(`${skillRootPath}/`),
      )
      .filter(
        (treeEntry) =>
          treeEntry.size === null ||
          treeEntry.size <= MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES,
      )
      .slice(0, MAX_OFFICIAL_INDEX_PACKAGE_FILES);

    if (packageFiles.length === 0) {
      continue;
    }

    const commitSha = await fetchGitHubBranchCommitSha(
      snapshot.owner,
      snapshot.repo,
      snapshot.repoSummary.defaultBranch,
    );
    if (requirePinnedProvenance && !commitSha) {
      continue;
    }

    const materializedFiles: Array<{ relativePath: string; content: string }> =
      [];
    const fetchRef = commitSha ?? snapshot.repoSummary.defaultBranch;

    for (const packageFile of packageFiles) {
      const fileContent = await fetchGitHubFileContent(
        snapshot.owner,
        snapshot.repo,
        fetchRef,
        packageFile.path,
        MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES,
      );
      if (fileContent === null) {
        continue;
      }

      materializedFiles.push({
        relativePath: packageFile.path.slice(skillRootPath.length + 1),
        content: fileContent,
      });
    }

    if (materializedFiles.length === 0) {
      continue;
    }

    const skillMarkdownFile = materializedFiles.find(
      (file) => file.relativePath === "SKILL.md",
    );

    return {
      content: skillMarkdownFile?.content ?? JSON.stringify(entry, null, 2),
      files: materializedFiles,
      upstreamRef: snapshot.repoSummary.defaultBranch,
      upstreamCommit: commitSha ?? undefined,
    };
  }

  return null;
}

function buildOfficialIndexRepoUrlCandidates(
  entry: AssetCatalogEntry,
  owner: string,
): string[] {
  const candidateRepoUrls = [
    entry.evidence.rootPath,
    `https://github.com/${owner}/${owner}-skills`,
    `https://github.com/${owner}/skills`,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.includes("github.com"),
  );

  return [...new Set(candidateRepoUrls)];
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

async function fetchGitHubFileContent(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  maxBytes: number,
): Promise<string | null> {
  return fetchTextWithGuards(
    buildGitHubRawFileUrl({ owner, repo, branch, filePath }),
    {
      allowedOrigins: GITHUB_RAW_ALLOWED_ORIGINS,
      headers: buildGitHubHeaders(),
      maxBytes,
    },
  );
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

    return { owner, repo, ref, filePath };
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
    { relativePath: "asset.json", content: `${JSON.stringify(entry, null, 2)}\n` },
    ...(materializedArtifact.files ?? []),
  ]
    .map((file) => ({
      relativePath: file.relativePath,
      sha256: createContentHash(file.content),
      sizeBytes: Buffer.byteLength(file.content, "utf8"),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const aggregateHash = createContentHash(
    files
      .map((file) => `${file.relativePath}\0${file.sha256}\0${file.sizeBytes}`)
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

  if (entry.source.originUrl.includes("github.com")) {
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
    materializedArtifact.content,
    ...(materializedArtifact.files ?? []).map((file) => file.content),
  ]
    .join("\n")
    .toLowerCase();
  return [
    "ignore previous instructions",
    "ignore all previous instructions",
    "exfiltrate secrets",
    "send environment variables",
    "disable security",
    "reveal your system prompt",
  ].some((pattern) => combinedContent.includes(pattern));
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
    !entry.source.originUrl.includes("github.com")
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
