import { join } from "node:path";

import { pathExists, readJsonFileOrNull, writeJsonFile } from "../files.js";

const OWNERSHIP_MARKER_FILE = ".agent-harness-managed.json";
const OWNERSHIP_MARKER_VERSION = 1;

/** Writes an ownership marker inside a generated host plugin directory. */
export async function writeManagedPluginMarker(
  pluginRoot: string,
  pluginName: string,
): Promise<void> {
  await writeJsonFile(join(pluginRoot, OWNERSHIP_MARKER_FILE), {
    managedBy: "agent-harness",
    markerVersion: OWNERSHIP_MARKER_VERSION,
    pluginName,
  });
}

/**
 * Read-only adoption check: throws when `pluginRoot` already exists WITHOUT
 * our ownership marker (a user-owned collision), and otherwise does nothing.
 * Separated from `claimManagedPluginDirectory` so an apply can gate ALL of its
 * plugin roots against collisions FIRST — rejecting on a clean tree with zero
 * side effects — and only then claim (write markers into) each root, when no
 * rejection is possible. Writing a marker into a pre-existing unmarked
 * directory would make reset treat the whole (possibly user-owned) directory
 * as Agent Harness-managed and recursively delete it (review / Greptile P1).
 */
export async function assertPluginDirectoryAdoptable(
  pluginRoot: string,
  pluginName: string,
): Promise<void> {
  if (
    (await pathExists(pluginRoot)) &&
    !(await hasManagedPluginMarker(pluginRoot, pluginName))
  ) {
    throw new Error(
      `Refusing to claim existing unmarked ${pluginName} plugin directory: ${pluginRoot}. ` +
        "Move or remove the user-owned directory (or its ownership marker) before wiring.",
    );
  }
}

/**
 * Claims a host plugin directory for this apply, refusing to adopt a
 * directory that already exists WITHOUT our ownership marker. Writing a
 * marker into a pre-existing unmarked directory would make reset treat the
 * whole (possibly user-owned) directory as Agent Harness-managed and
 * recursively delete it (review / Greptile P1). A directory created this
 * apply (absent before) or one already carrying our marker is safe to claim.
 * Returns whether the marker was written (true when the dir is newly claimed).
 */
export async function claimManagedPluginDirectory(
  pluginRoot: string,
  pluginName: string,
): Promise<void> {
  await assertPluginDirectoryAdoptable(pluginRoot, pluginName);
  await writeManagedPluginMarker(pluginRoot, pluginName);
}

/** Returns true only for a plugin directory explicitly marked by this adapter. */
export async function hasManagedPluginMarker(
  pluginRoot: string,
  pluginName: string,
): Promise<boolean> {
  const marker = await readJsonFileOrNull<unknown>(
    join(pluginRoot, OWNERSHIP_MARKER_FILE),
  );
  return (
    isRecord(marker) &&
    marker.managedBy === "agent-harness" &&
    marker.markerVersion === OWNERSHIP_MARKER_VERSION &&
    marker.pluginName === pluginName
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
