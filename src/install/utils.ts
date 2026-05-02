import type { BundleLock, MirrorIndexEntry } from "../types.js";

export const INSTALL_HOSTS: Array<BundleLock["host"]> = [
  "opencode",
  "copilot-vscode",
  "shared",
];

export function sanitizeMirrorId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

export function sanitizeAssetId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

export function getInstallableAssets(
  bundleAssets: BundleLock["assets"],
  mirrorIndexById: Map<string, MirrorIndexEntry>,
): BundleLock["assets"] {
  return bundleAssets.filter((asset) => {
    const mirrorEntry = mirrorIndexById.get(asset.mirrorId);
    return Boolean(mirrorEntry && mirrorEntry.status !== "quarantined");
  });
}
