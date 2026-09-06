import { isJsonObject } from "./native-utils.js";
import type { JsonObject } from "./native-utils.js";

/**
 * Identity fields that prove a marketplace entry is owned by Agent Harness.
 * The plugin name alone is intentionally not sufficient: users may have a
 * different plugin with the same public name.
 */
export interface ManagedMarketplaceEntryIdentity {
  name: string;
  sourcePath?: string;
  localSourcePath?: string;
  legacyPath?: string;
}

/** Returns whether a marketplace entry matches the managed local identity. */
export function isManagedMarketplaceEntry(
  value: unknown,
  identity: ManagedMarketplaceEntryIdentity,
): value is JsonObject {
  if (!isJsonObject(value) || value.name !== identity.name) return false;

  if (
    identity.sourcePath !== undefined &&
    value.source === identity.sourcePath
  ) {
    return true;
  }

  if (identity.localSourcePath !== undefined && isJsonObject(value.source)) {
    return (
      value.source.source === "local" &&
      value.source.path === identity.localSourcePath
    );
  }

  return (
    identity.legacyPath !== undefined && value.path === identity.legacyPath
  );
}

/** Replaces only entries proven to be Agent Harness-managed. */
export function replaceManagedMarketplaceEntry(
  entries: readonly unknown[],
  identity: ManagedMarketplaceEntryIdentity,
  replacement: JsonObject,
): unknown[] {
  return [
    ...entries.filter((entry) => !isManagedMarketplaceEntry(entry, identity)),
    replacement,
  ];
}

/** Removes only entries proven to be Agent Harness-managed. */
export function removeManagedMarketplaceEntries(
  entries: readonly unknown[],
  identity: ManagedMarketplaceEntryIdentity,
): unknown[] {
  return entries.filter((entry) => !isManagedMarketplaceEntry(entry, identity));
}
