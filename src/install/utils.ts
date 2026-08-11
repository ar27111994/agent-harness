import { sanitizeAssetId } from "../lib/safe-paths.js";
import { CliUsageError } from "../cli-help-format.js";
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
 * Validates a user-supplied install-domain `--host` value against the known
 * install hosts (#446 contract, review): empty values and unknown hosts throw
 * a clean one-line `CliUsageError` instead of a raw stack, and the error
 * message shape is shared by every install subcommand that accepts `--host`.
 *
 * @param value - The option value, or `undefined` when `--host` was absent.
 * @param usageHint - `agent-harness install <subcommand> --help` hint.
 * @returns The validated host value, or `undefined` when not provided.
 */
export function validateInstallHostValue(
  value: string | undefined,
  usageHint: string,
): (typeof INSTALL_HOSTS)[number] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.trim() === "") {
    throw new CliUsageError(
      `Invalid --host value. Must be one of: ${INSTALL_HOSTS.join(", ")}`,
      usageHint,
    );
  }
  if (!INSTALL_HOSTS.includes(value as (typeof INSTALL_HOSTS)[number])) {
    throw new CliUsageError(
      `Unknown --host '${value}'. Must be one of: ${INSTALL_HOSTS.join(", ")}`,
      usageHint,
    );
  }
  return value as (typeof INSTALL_HOSTS)[number];
}

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
