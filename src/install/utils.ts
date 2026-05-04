import { sanitizeAssetId } from "../lib/safe-paths.js";
import type { LifecycleHost } from "../host-adapters/registry.js";
import type { BundleLock, MirrorIndexEntry } from "../types.js";

type InstallHost = LifecycleHost | "shared";

// Install roots are the registered lifecycle hosts plus the shared MCP root.
/**
 * Defines install hosts shared by the lifecycle pipeline.
 */
export const INSTALL_HOSTS = [
  "opencode",
  "copilot-vscode",
  "shared",
] as const satisfies readonly InstallHost[];

/**
 * Re-exports package-safe asset identifier sanitization for install callers.
 */
export { sanitizeAssetId };

/**
 * Returns get installable assets for the provided inputs.
 */
export function getInstallableAssets(
  bundleAssets: BundleLock["assets"],
  mirrorIndexById: Map<string, MirrorIndexEntry>,
): BundleLock["assets"] {
  return bundleAssets.filter((asset) => {
    const mirrorEntry = mirrorIndexById.get(asset.mirrorId);
    return Boolean(
      asset.activationEligible && mirrorEntry && mirrorEntry.status !== "quarantined",
    );
  });
}
