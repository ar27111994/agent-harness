import { sanitizeAssetId } from "../lib/safe-paths.js";
import type { BundleLock, MirrorIndexEntry } from "../types.js";

export const INSTALL_HOSTS: Array<BundleLock["host"]> = [
  "opencode",
  "copilot-vscode",
  "shared",
];


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
