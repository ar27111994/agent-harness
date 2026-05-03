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

  const officialSkillPageContent = await resolveOfficialSkillPageContent(asset);
  if (officialSkillPageContent) {
    return { asset, content: officialSkillPageContent };
  }

  return {
    asset,
    content: buildMetadataFallback(asset),
  };
}

function shouldUseMirroredContent(
  _asset: AssetCatalogEntry,
  mirroredContent: string | null,
): boolean {
  return Boolean(mirroredContent);
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

function sanitizeAssetId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}
