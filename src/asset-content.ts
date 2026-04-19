import { join } from "node:path";

import { readJsonFileOrNull, readTextFileOrNull } from "./files.js";
import { fetchOfficialIndexPageContent } from "./official-index.js";
import type { AssetCatalogEntry } from "./types.js";

export async function resolveAssetContent(options: {
  projectRoot: string;
  activationRoot: string;
  assetId: string;
}): Promise<{ asset: AssetCatalogEntry; content: string } | null> {
  const asset = await readJsonFileOrNull<AssetCatalogEntry>(
    join(
      options.activationRoot,
      sanitizeAssetId(options.assetId),
      "asset.json",
    ),
  );
  if (!asset) {
    return null;
  }

  const mirroredContent = await readTextFileOrNull(
    join(
      options.activationRoot,
      sanitizeAssetId(options.assetId),
      "content.txt",
    ),
  );

  if (shouldUseMirroredContent(asset, mirroredContent)) {
    return {
      asset,
      content: mirroredContent!,
    };
  }

  const githubContent = await resolveGitHubAssetContent(asset);
  if (githubContent) {
    return { asset, content: githubContent };
  }

  const officialSkillPageContent = await resolveOfficialSkillPageContent(asset);
  if (officialSkillPageContent) {
    return { asset, content: officialSkillPageContent };
  }

  if (mirroredContent) {
    return {
      asset,
      content: buildMetadataFallback(asset, mirroredContent),
    };
  }

  return {
    asset,
    content: buildMetadataFallback(asset),
  };
}

function shouldUseMirroredContent(
  asset: AssetCatalogEntry,
  mirroredContent: string | null,
): boolean {
  if (!mirroredContent) {
    return false;
  }

  if (asset.install.method === "official-index-entry") {
    return true;
  }

  if (asset.install.method === "local-file") {
    return true;
  }

  if (
    asset.source.sourceKind === "local-directory" ||
    asset.source.sourceKind === "local-manifest"
  ) {
    return true;
  }

  return false;
}

async function resolveGitHubAssetContent(
  asset: AssetCatalogEntry,
): Promise<string | null> {
  const repoInfo = parseGitHubRepoInfo(asset);
  if (!repoInfo || !asset.evidence.filePath) {
    return null;
  }

  const rawUrlCandidates = buildGitHubRawUrlCandidates(
    repoInfo.owner,
    repoInfo.repo,
    asset.evidence.filePath,
  );

  for (const rawUrl of rawUrlCandidates) {
    try {
      const response = await fetch(rawUrl, {
        headers: buildGitHubHeaders(),
      });
      if (!response.ok) {
        continue;
      }

      return await response.text();
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveOfficialSkillPageContent(
  asset: AssetCatalogEntry,
): Promise<string | null> {
  if (!asset.source.originUrl.includes("officialskills.sh/")) {
    return null;
  }

  return fetchOfficialIndexPageContent(asset.source.originUrl);
}

function buildMetadataFallback(
  asset: AssetCatalogEntry,
  mirroredContent?: string,
): string {
  const lines = [
    `# ${asset.displayName}`,
    "",
    `- Asset ID: ${asset.id}`,
    `- Source: ${asset.source.sourceId}`,
    `- Authority: ${asset.source.authorityTier}`,
    `- Compatibility: ${asset.compatibilityMode}`,
    `- Origin: ${asset.source.originUrl}`,
    "",
    "## Capabilities",
    ...asset.capabilities.map((capability) => `- ${capability}`),
  ];

  if (mirroredContent) {
    lines.push(
      "",
      "## Mirrored content snapshot",
      "",
      "```json",
      mirroredContent,
      "```",
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

function parseGitHubRepoInfo(
  asset: AssetCatalogEntry,
): { owner: string; repo: string } | null {
  const urlsToCheck = [asset.source.originUrl, asset.evidence.rootPath].filter(
    (value): value is string => typeof value === "string",
  );

  for (const url of urlsToCheck) {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)/iu.exec(url);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/u, ""),
      };
    }
  }

  return null;
}

function buildGitHubRawUrlCandidates(
  owner: string,
  repo: string,
  filePath: string,
): string[] {
  const possibleBranches = ["main", "master"];
  return possibleBranches.map(
    (branch) =>
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
  );
}

function sanitizeAssetId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

function buildGitHubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": "agent-harness",
  };

  const githubToken =
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  return headers;
}
