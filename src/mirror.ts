import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { getRuntimeConfig } from "./config/runtime.js";
import {
  createContentHash,
  ensureCleanDirectory,
  ensureDirectory,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
  writeJsonFile,
  writeJsonLinesFile,
  writeTextFile,
} from "./files.js";
import {
  buildGitHubRawFileUrl,
  fetchGitHubRepoSnapshotByRepoUrl,
} from "./github.js";
import { fetchOfficialIndexPageContent } from "./official-index.js";
import { getOptionValue } from "./lib/cli-options.js";
import { fetchJsonWithGuards, fetchTextWithGuards } from "./lib/http.js";
import {
  assertAssetCatalogEntry,
  assertMirrorIndexEntry,
  assertMirrorPolicy,
} from "./manifest-validation.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  BundleLockAsset,
  DemandProfile,
  MirrorAcquireState,
  MirrorIndexEntry,
  MirrorPlan,
  MirrorPolicy,
  SourceIndex,
} from "./types.js";

const MIRROR_PLAN_OUTPUT_PATH = ["mirror", "audit", "mirror-plan.json"];
const MIRROR_INDEX_OUTPUT_PATH = ["mirror", "index.jsonl"];
const MIRROR_ACQUIRE_STATE_OUTPUT_PATH = [
  "state",
  "mirror",
  "acquire-state.json",
];
const MAX_OFFICIAL_INDEX_PACKAGE_FILES = 50;
const MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES = 150_000;
const MAX_GITHUB_MIRROR_FILE_SIZE_BYTES = 500_000;
const GITHUB_RAW_ALLOWED_ORIGINS = [
  "https://raw.githubusercontent.com",
] as const;
const GITHUB_API_ALLOWED_ORIGINS = ["https://api.github.com"] as const;

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

export async function runMirror(
  args: string[],
  _workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  switch (command) {
    case "plan":
      await generateMirrorPlan(projectRoot);
      return 0;
    case "locks":
      await generateBundleLocks(projectRoot);
      return 0;
    case "acquire":
      await acquireMirrorArtifacts(projectRoot, rest);
      return 0;
    case "help":
      printMirrorHelp();
      return 0;
    default:
      printMirrorHelp();
      return 1;
  }
}

async function generateMirrorPlan(projectRoot: string): Promise<void> {
  const policy = await readJsonFile<MirrorPolicy>(
    join(projectRoot, "mirror", "policy.json"),
    assertMirrorPolicy,
  );
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
  );
  const sourceIndex = await readJsonFileOrNull<SourceIndex>(
    join(projectRoot, "discover", "output", "source-index.json"),
  );
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "catalog.assets.jsonl"),
    assertAssetCatalogEntry,
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );
  const selectedCatalogEntries = selectedEntries.length;
  const mirrorEligibleEntries = catalogEntries.filter(
    (entry) => entry.status.mirrorEligible,
  );

  const nextActions = buildNextActions(
    demandProfile,
    sourceIndex,
    catalogEntries.length,
    mirrorEligibleEntries.length,
    selectedCatalogEntries,
  );

  const mirrorPlan: MirrorPlan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      demandProfile: demandProfile !== null,
      sourceIndex: sourceIndex !== null,
      catalogEntries: catalogEntries.length,
      mirrorEligibleEntries: mirrorEligibleEntries.length,
      selectedCatalogEntries,
    },
    candidateBreakdown: {
      byHost: countEntriesByHost(mirrorEligibleEntries),
      byAssetKind: countEntriesByAssetKind(mirrorEligibleEntries),
    },
    policies: {
      officialBeatsPopularity: policy.selection.officialBeatsPopularity,
      communityDefaultPolicy: policy.selection.communityDefaultPolicy,
      alwaysAudit: policy.audit.alwaysAudit,
    },
    bundleTemplates: policy.bundleTemplates,
    nextActions,
  };

  const outputPath = join(projectRoot, ...MIRROR_PLAN_OUTPUT_PATH);
  await writeJsonFile(outputPath, mirrorPlan);

  console.log(`Mirror plan written to ${toPosixPath(outputPath)}`);
}

function printMirrorHelp(): void {
  console.log(`mirror commands:
  plan    Summarize mirror readiness into mirror/audit/mirror-plan.json
  locks   Generate initial bundle lock files from selected catalog entries
  acquire Acquire raw mirror artifacts, write mirror index, and resolve bundle locks`);
}

function buildNextActions(
  demandProfile: DemandProfile | null,
  sourceIndex: SourceIndex | null,
  catalogEntries: number,
  mirrorEligibleEntries: number,
  selectedCatalogEntries: number,
): string[] {
  const nextActions: string[] = [];

  if (!demandProfile) {
    nextActions.push(
      "Run discover demand-profile to capture current-directory portfolio signals.",
    );
  }

  if (!sourceIndex) {
    nextActions.push(
      "Run discover sources to summarize enabled discovery sources.",
    );
  }

  if (catalogEntries === 0) {
    nextActions.push(
      "Run discover catalog to harvest local manifest and local directory sources into discover/catalog.assets.jsonl.",
    );
  }

  if (catalogEntries > 0 && mirrorEligibleEntries === 0) {
    nextActions.push(
      "Review catalog statuses and enable mirror eligibility only for approved local assets.",
    );
  }

  if (selectedCatalogEntries === 0) {
    nextActions.push(
      "Create discover/output/catalog.selected.jsonl after canonical selection and promotion rules are applied to catalog entries.",
    );
  }

  if (nextActions.length === 0) {
    nextActions.push(
      "Resolve exact artifact versions for canonical selected assets before writing mirror locks.",
    );
    nextActions.push(
      "Mirror only canonical or explicitly approved alternative assets into the inert mirror store.",
    );
  }

  return nextActions;
}

async function generateBundleLocks(projectRoot: string): Promise<void> {
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

  for (const bundleTemplate of policy.bundleTemplates) {
    const bundleAssets = mirrorEligibleEntries
      .filter((entry) =>
        shouldIncludeEntryInBundle(
          entry,
          bundleTemplate.id,
          bundleTemplate.host,
          bundleTemplate.assetKinds,
        ),
      )
      .map((entry) => createBundleLockAsset(entry, bundleTemplate.id))
      .filter(
        (asset, index, assets) =>
          assets.findIndex(
            (candidate) => candidate.assetId === asset.assetId,
          ) === index,
      )
      .sort((left, right) => left.assetId.localeCompare(right.assetId));

    const bundleLock: BundleLock = {
      schemaVersion: 1,
      bundleId: bundleTemplate.id,
      generatedAt: new Date().toISOString(),
      host: bundleTemplate.host,
      assets: bundleAssets,
    };

    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", `${bundleTemplate.id}.lock.json`),
      bundleLock,
    );
  }

  console.log(
    `Bundle locks written to ${toPosixPath(join(projectRoot, "mirror", "bundles"))}`,
  );
}

async function acquireMirrorArtifacts(
  projectRoot: string,
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

  for (const entry of entriesToAcquire) {
    const materializedArtifact = await materializeMirrorArtifact(
      entry,
      projectRoot,
      policy.selection.requirePinnedProvenance,
    );
    if (materializedArtifact === null) {
      continue;
    }

    const fileManifest = buildMirrorFileManifest(materializedArtifact);
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
  await writeJsonLinesFile(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    mergedMirrorIndexEntries,
  );
  await resolveBundleLocks(projectRoot, mergedMirrorIndexEntries);
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

function shouldIncludeEntryInBundle(
  entry: AssetCatalogEntry,
  bundleId: string,
  bundleHost: BundleLock["host"],
  allowedAssetKinds: string[],
): boolean {
  if (!allowedAssetKinds.includes(entry.assetKind)) {
    return false;
  }

  if (bundleId === "community-stable") {
    return (
      entry.source.sourceId === "local-antigravity-manifest" &&
      entry.install.method === "local-file"
    );
  }

  if (bundleId === "copilot-core") {
    return (
      entry.hosts.includes("copilot-vscode") &&
      (entry.assetKind === "instruction" ||
        entry.assetKind === "agent" ||
        entry.assetKind === "workflow" ||
        entry.assetKind === "hook" ||
        entry.assetKind === "plugin" ||
        entry.assetKind === "extension" ||
        (entry.assetKind === "skill" &&
          entry.source.authorityTier === "official-first-party" &&
          entry.fit.portfolioFit >= 0.3))
    );
  }

  if (bundleId === "shared-mcp") {
    return entry.hosts.includes("shared") || entry.assetKind === "mcp-server";
  }

  if (bundleHost === "shared") {
    return entry.hosts.includes("shared");
  }

  return entry.hosts.includes(bundleHost);
}

function createBundleLockAsset(
  entry: AssetCatalogEntry,
  bundleId: string,
): BundleLockAsset {
  return {
    assetId: entry.id,
    mirrorId: `unresolved:${entry.id}`,
    projectionType: determineProjectionType(entry, bundleId),
    activationEligible: entry.status.activationEligible,
    notes: entry.status.activationEligible
      ? "Resolve exact upstream artifact and replace unresolved mirrorId during raw mirror acquisition."
      : "Asset is mirrored for audit only and will not activate until explicitly promoted.",
  };
}

function determineProjectionType(
  entry: AssetCatalogEntry,
  bundleId: string,
): string {
  if (bundleId === "shared-mcp") {
    return "shared-mcp-candidate";
  }

  if (entry.compatibilityMode === "native") {
    return `native-${entry.assetKind}`;
  }

  return `adapted-${entry.assetKind}`;
}

async function materializeMirrorArtifact(
  entry: AssetCatalogEntry,
  projectRoot: string,
  requirePinnedProvenance: boolean,
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
  if (filePath && (await pathLooksReadable(filePath))) {
    const fileContent = await readTextFileOrNull(filePath);
    if (fileContent !== null) {
      return {
        content: fileContent,
      };
    }
  }

  const cachePath = buildGitHubCachePath(entry, projectRoot);
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
): MirrorFileManifest {
  const files = [
    { relativePath: "content.txt", content: materializedArtifact.content },
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

async function resolveBundleLocks(
  projectRoot: string,
  mirrorIndexEntries: MirrorIndexEntry[],
): Promise<void> {
  const mirrorIdByAssetId = new Map(
    mirrorIndexEntries.map((entry) => [entry.assetId, entry.mirrorId]),
  );
  const bundlePaths = [
    join(projectRoot, "mirror", "bundles", "opencode-global.lock.json"),
    join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
    join(projectRoot, "mirror", "bundles", "shared-mcp.lock.json"),
    join(projectRoot, "mirror", "bundles", "community-stable.lock.json"),
  ];

  for (const bundlePath of bundlePaths) {
    const bundleLock = await readJsonFile<BundleLock>(bundlePath);
    const resolvedAssets = bundleLock.assets.map((asset) => ({
      ...asset,
      mirrorId: mirrorIdByAssetId.get(asset.assetId) ?? asset.mirrorId,
    }));

    await writeJsonFile(bundlePath, {
      ...bundleLock,
      assets: resolvedAssets,
    });
  }
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

function sanitizeMirrorId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

export function resolveSafeMirrorFilePath(
  rawRoot: string,
  relativePath: string,
): string {
  const resolvedRoot = resolve(rawRoot);
  const resolvedTarget = resolve(resolvedRoot, relativePath);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);

  if (
    relativeTarget.length === 0 ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(
      `Refusing to write mirrored artifact outside raw root: ${relativePath}`,
    );
  }

  return resolvedTarget;
}

function countEntriesByHost(
  entries: AssetCatalogEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    for (const host of entry.hosts) {
      counts[host] = (counts[host] ?? 0) + 1;
    }
  }

  return counts;
}

function countEntriesByAssetKind(
  entries: AssetCatalogEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    counts[entry.assetKind] = (counts[entry.assetKind] ?? 0) + 1;
  }

  return counts;
}
