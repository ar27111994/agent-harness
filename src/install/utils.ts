import { sanitizeAssetId } from "../lib/safe-paths.js";
import type { LifecycleHost } from "../host-adapters/registry.js";
import type { BundleLock, MirrorIndexEntry } from "../types.js";

type InstallHost = LifecycleHost | "shared";

// Install roots are the registered lifecycle hosts plus the shared MCP root.
export const INSTALL_HOSTS = [
  "opencode",
  "copilot-vscode",
  "shared",
] as const satisfies readonly InstallHost[];

export { sanitizeAssetId };


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
