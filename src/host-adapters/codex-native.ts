import { dirname, join, relative } from "node:path";

import {
  readJsonFileOrNull,
  removePath,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  ManagedTextFileSnapshot,
  NativeConfigOperation,
} from "../types.js";
import {
  applyStructuredNativeConfig,
  assertJsonObject,
  buildManagedInstructionLines,
  buildNativeAssetContentSections,
  buildSkillFile,
  isJsonObject,
  removeEmptyParentDirectories,
  removeManagedSectionFile,
  restoreManagedTextFileSnapshot,
  upsertManagedSectionFile,
} from "./native-utils.js";
import type {
  JsonObject,
  NativeAsset,
  WireNativeFilesOptions,
} from "./native-utils.js";

/**
 * Writes Codex-native managed files.
 */
export async function writeCodexNativeFiles(
  options: WireNativeFilesOptions,
): Promise<NativeConfigOperation[]> {
  const managedLines = buildManagedInstructionLines({
    hostName: "OpenAI Codex",
    managedRoot: options.managedRoot,
    nativeAssets: options.nativeAssets,
    materializedAssets: options.materializedAssets,
    mcpServers: options.mcpServers,
  });

  await upsertManagedSectionFile(
    join(options.workspaceRoot, "AGENTS.md"),
    "agent-harness-codex",
    [
      "Use these Agent Harness assets as project-scoped Codex context.",
      "Do not treat plugin, MCP, hook, or rules references as active integrations unless structured Codex-native config exists in the wire plan.",
      "",
      ...managedLines,
    ],
  );
  await writeTextFile(
    join(
      options.workspaceRoot,
      ".agents",
      "skills",
      "agent-harness",
      "SKILL.md",
    ),
    buildSkillFile(
      "agent-harness",
      "Use curated Agent Harness assets for this Codex project.",
      [
        ...managedLines,
        ...buildNativeAssetContentSections(options.nativeAssets, ["skill"]),
      ],
    ),
  );
  await mergeCodexPluginMarketplace(
    join(options.workspaceRoot, ".agents", "plugins", "marketplace.json"),
  );
  const codexPluginRoot = join(
    options.workspaceRoot,
    ".agents",
    "plugins",
    "agent-harness",
  );
  const codexPluginManifest = buildCodexPluginManifest(options.nativeAssets);
  await writeJsonFile(
    join(codexPluginRoot, ".codex-plugin", "plugin.json"),
    codexPluginManifest,
  );
  if (typeof codexPluginManifest.hooks === "string") {
    await writeJsonFile(
      join(codexPluginRoot, codexPluginManifest.hooks),
      buildCodexHooksManifest(
        options.nativeAssets,
        options.materializedAssets.hookFiles,
        join(codexPluginRoot, codexPluginManifest.hooks),
      ),
    );
  }
  await writeTextFile(
    join(
      options.workspaceRoot,
      ".agents",
      "plugins",
      "agent-harness",
      "skills",
      "agent-harness",
      "SKILL.md",
    ),
    buildSkillFile(
      "agent-harness",
      "Use curated Agent Harness assets from the Codex plugin surface.",
      [
        ...managedLines,
        ...buildNativeAssetContentSections(options.nativeAssets, ["skill"]),
      ],
    ),
  );

  return applyStructuredNativeConfig(options.workspaceRoot, "codex", {
    nativeAssets: options.nativeAssets,
  });
}

/**
 * Merges agent-harness entry into Codex plugin marketplace.
 */
export async function mergeCodexPluginMarketplace(
  filePath: string,
): Promise<void> {
  const marketplace = await readJsonFileOrNull<unknown>(filePath);
  const marketplaceObject =
    marketplace === null ? {} : assertJsonObject(marketplace, filePath);
  const plugins = coerceJsonObjectArray(marketplaceObject.plugins).filter(
    (plugin) => !isNamedJsonObject(plugin, "agent-harness"),
  );
  await writeJsonFile(filePath, {
    ...marketplaceObject,
    schemaVersion:
      typeof marketplaceObject.schemaVersion === "number"
        ? marketplaceObject.schemaVersion
        : 1,
    plugins: [
      ...plugins,
      {
        name: "agent-harness",
        path: "./agent-harness",
      },
    ],
  });
}

/**
 * Builds a Codex plugin manifest from native assets.
 */
export function buildCodexPluginManifest(
  nativeAssets: NativeAsset[],
): JsonObject {
  const assetKinds = new Set(
    nativeAssets.map((nativeAsset) => nativeAsset.assetKind),
  );
  const manifest: JsonObject = {
    name: "agent-harness",
    version: "1.0.0",
    description: "Project-local Agent Harness assets for OpenAI Codex.",
    skills: "./skills",
  };

  if (assetKinds.has("hook")) {
    manifest.hooks = "./hooks/hooks.json";
  }

  return manifest;
}

/**
 * Builds a Codex hooks manifest from native assets.
 */
export function buildCodexHooksManifest(
  nativeAssets: NativeAsset[],
  hookFiles: readonly string[],
  manifestPath?: string,
): JsonObject {
  const manifestDirectory = manifestPath ? dirname(manifestPath) : undefined;
  const hookAssets = nativeAssets.filter(
    (nativeAsset) => nativeAsset.assetKind === "hook",
  );
  // Build a lookup from asset slug to hook file path so sorting
  // hookFiles cannot mispair manifest entries with the wrong asset.
  const hookFileBySlug = new Map<string, string>();
  for (const file of hookFiles) {
    // Extract the slug from the hook file path (format: .../hooks/<slug>/hook.md)
    const segments = file.replace(/\\/gu, "/").split("/");
    const hooksIdx = segments.lastIndexOf("hooks");
    if (hooksIdx >= 0 && hooksIdx + 1 < segments.length) {
      hookFileBySlug.set(segments[hooksIdx + 1], file);
    }
  }
  return {
    schemaVersion: 1,
    hooks: hookAssets.map((nativeAsset) => {
      const assetSlug = sanitizeAssetId(nativeAsset.assetId);
      const matchedFile = hookFileBySlug.get(assetSlug);
      return {
        name: nativeAsset.assetId,
        description: nativeAsset.displayName,
        source: buildCodexHookSource(
          matchedFile,
          nativeAsset.assetId,
          manifestDirectory,
        ),
      };
    }),
  };
}

function buildCodexHookSource(
  hookFile: string | undefined,
  fallback: string,
  manifestDirectory: string | undefined,
): string {
  if (!hookFile) {
    return fallback;
  }
  if (!manifestDirectory) {
    return hookFile;
  }

  return toPosixPath(relative(manifestDirectory, hookFile));
}

function isNamedJsonObject(value: unknown, name: string): boolean {
  return isJsonObject(value) && value.name === name;
}

function coerceJsonObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

/**
 * Removes all Codex-native files installed by agent-harness.
 */
export async function resetCodexNativeHost(
  workspaceRoot: string,
  textFileSnapshots: ManagedTextFileSnapshot[] | undefined,
): Promise<void> {
  await restoreManagedTextFileSnapshot(
    join(workspaceRoot, "AGENTS.md"),
    textFileSnapshots,
    () =>
      removeManagedSectionFile(
        join(workspaceRoot, "AGENTS.md"),
        "agent-harness-codex",
      ),
  );
  await removePath(join(workspaceRoot, ".agents", "skills", "agent-harness"));
  await removePath(join(workspaceRoot, ".agents", "plugins", "agent-harness"));
  await removeCodexPluginMarketplaceEntry(
    join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".agents", "plugins"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".agents", "skills"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".agents"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".codex"),
    workspaceRoot,
  );
}

async function removeCodexPluginMarketplaceEntry(
  filePath: string,
): Promise<void> {
  const marketplace = await readJsonFileOrNull<unknown>(filePath);
  if (marketplace === null) {
    return;
  }
  const marketplaceObject = assertJsonObject(marketplace, filePath);
  const rawPlugins = Array.isArray(marketplaceObject.plugins)
    ? marketplaceObject.plugins
    : [];
  // Preserve non-object entries and filter out agent-harness
  const plugins = rawPlugins.filter(
    (plugin) => !(isJsonObject(plugin) && isNamedJsonObject(plugin, "agent-harness")),
  );
  // Always preserve the file with all top-level keys intact
  await writeJsonFile(filePath, {
    ...marketplaceObject,
    plugins,
  });
}
