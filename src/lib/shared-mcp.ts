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

/**
 * Reads shared mcp asset ids from project state.
 */
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
    const bundleManifest = await readJsonFileOrNull<unknown>(
      join(
        projectRoot,
        "install",
        "shared",
        "bundles",
        `${bundleId}.install.json`,
      ),
    );

    const packages = getInstalledBundlePackages(bundleManifest, bundleId);

    for (const pkg of packages) {
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

function getInstalledBundlePackages(
  value: unknown,
  bundleId: string,
): InstalledBundleManifest["packages"] {
  if (value === null) {
    return [];
  }

  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<InstalledBundleManifest>).packages)
  ) {
    return (value as InstalledBundleManifest).packages;
  }

  console.warn(
    `Skipping malformed shared install bundle manifest for '${bundleId}'; expected an object with a packages array.`,
  );
  return [];
}
