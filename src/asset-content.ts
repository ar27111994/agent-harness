import { join } from "node:path";

import { readJsonFileOrNull, readTextFileOrNull } from "./files.js";
import { sanitizeAssetId } from "./lib/safe-paths.js";
import { fetchOfficialIndexPageContent } from "./official-index.js";
import type { AssetCatalogEntry } from "./types.js";

/**
 * Resolves asset content from the provided inputs.
 */
export async function resolveAssetContent(options: {
  activationRoot: string;
  assetId: string;
}): Promise<{ asset: AssetCatalogEntry; content: string } | null> {
  const sanitizedId = sanitizeAssetId(options.assetId);
  const asset = await readJsonFileOrNull<AssetCatalogEntry>(
    join(options.activationRoot, sanitizedId, "asset.json"),
  );
  if (!asset) {
    return null;
  }

  const mirroredContent = await readTextFileOrNull(
    join(options.activationRoot, sanitizedId, "content.txt"),
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
  let originUrl: URL;
  try {
    originUrl = new URL(asset.source.originUrl);
  } catch {
    return null;
  }

  const hostname = originUrl.hostname.toLowerCase();
  if (
    hostname !== "officialskills.sh" &&
    !hostname.endsWith(".officialskills.sh")
  ) {
    return null;
  }

  return fetchOfficialIndexPageContent(asset.source.originUrl);
}

function buildMetadataFallback(asset: AssetCatalogEntry): string {
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

  return `${lines.join("\n").trim()}\n`;
}
