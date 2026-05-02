import { join } from "node:path";

import { readJsonFile, readJsonFileOrNull } from "../files.js";
import {
  assertActivationManifest,
  assertInstalledPackageManifest,
} from "../manifest-validation.js";
import type {
  ActivationManifest,
  InstalledBundleManifest,
  InstalledPackageManifest,
} from "../types.js";

export async function readSharedMcpAssetIds(
  projectRoot: string,
): Promise<string[]> {
  const sharedActivationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    assertActivationManifest,
  );

  if (!sharedActivationManifest) {
    return [];
  }

  const activeAssetIds = new Set(sharedActivationManifest.activeAssets);
  const mcpAssetIds = new Set<string>();

  for (const bundleId of sharedActivationManifest.activeBundles) {
    const bundleManifest = await readJsonFileOrNull<InstalledBundleManifest>(
      join(
        projectRoot,
        "install",
        "shared",
        "bundles",
        `${bundleId}.install.json`,
      ),
    );

    for (const pkg of bundleManifest?.packages ?? []) {
      if (!activeAssetIds.has(pkg.assetId)) {
        continue;
      }

      const packageManifest = await readJsonFile<InstalledPackageManifest>(
        pkg.manifestPath,
        assertInstalledPackageManifest,
      );
      if (packageManifest.assetKind === "mcp-server") {
        mcpAssetIds.add(packageManifest.assetId);
      }
    }
  }

  return [...mcpAssetIds].sort((left, right) => left.localeCompare(right));
}
