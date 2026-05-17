import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { writeJsonFile } from "../files.js";
import {
  isHostCompatibleWithRecommendationHost,
  listHostAdapters,
  registerHostAdapter,
  resolveHostAdapter,
  type HostAdapter,
} from "../host-adapters/registry.js";
import {
  resolveDefaultClaudeCodeConfigRoot,
  resolveDefaultCursorConfigRoot,
  resolveDefaultOpenCodeConfigRoot,
  resolveHomeRelativePath,
  resolvePortablePath,
  resolveVsCodeUserSettingsPath,
  toHomeRelativePath,
} from "../lib/paths.js";
import {
  isPathWithinRoot,
  resolveAllowedAbsolutePath,
  resolveAllowedRealFilePath,
  resolveSafeMirrorFilePath,
  sanitizeAssetId,
  sanitizeMirrorId,
} from "../lib/safe-paths.js";
import { readSharedMcpAssetIds } from "../lib/shared-mcp.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  HostTarget,
  InstalledBundleManifest,
  InstalledPackageManifest,
} from "../types.js";

void test("path helpers resolve home-relative and host config paths from runtime config", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-paths-"));
  const homeDirectory = join(tempRoot, "home");
  const appDataDirectory = join(tempRoot, "appdata");
  const xdgConfigHome = join(tempRoot, "xdg");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(appDataDirectory, { recursive: true }),
    mkdir(xdgConfigHome, { recursive: true }),
  ]);

  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.AGENT_HARNESS_HOME = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  const projectRoot = join(tempRoot, "project");

  assert.equal(resolveHomeRelativePath("~"), homeDirectory);
  assert.equal(
    resolveHomeRelativePath("~/workspace/config.json"),
    join(homeDirectory, "workspace", "config.json"),
  );
  assert.equal(resolvePortablePath(undefined, projectRoot), projectRoot);
  assert.equal(resolvePortablePath("", projectRoot), projectRoot);
  assert.equal(
    resolvePortablePath("~/workspace/config.json", projectRoot),
    join(homeDirectory, "workspace", "config.json"),
  );
  assert.equal(
    resolvePortablePath("relative/config.json", projectRoot),
    resolve(projectRoot, "relative", "config.json"),
  );

  const homeNestedPath = join(homeDirectory, "nested", "settings.json");
  assert.equal(toHomeRelativePath(homeDirectory), "~");
  assert.equal(toHomeRelativePath(homeNestedPath), "~/nested/settings.json");
  assert.equal(
    toHomeRelativePath(join(tempRoot, "outside", "settings.json")),
    normalize(join(tempRoot, "outside", "settings.json")).replace(/\\/gu, "/"),
  );

  const expectedVsCodeSettingsPath =
    process.platform === "win32"
      ? join(appDataDirectory, "Code", "User", "settings.json")
      : process.platform === "darwin"
        ? join(
            homeDirectory,
            "Library",
            "Application Support",
            "Code",
            "User",
            "settings.json",
          )
        : join(xdgConfigHome, "Code", "User", "settings.json");
  const expectedOpenCodeConfigRoot =
    process.platform === "win32"
      ? join(appDataDirectory, "opencode")
      : process.platform === "darwin"
        ? join(homeDirectory, "Library", "Application Support", "opencode")
        : join(xdgConfigHome, "opencode");

  assert.equal(resolveVsCodeUserSettingsPath(), expectedVsCodeSettingsPath);
  assert.equal(resolveDefaultOpenCodeConfigRoot(), expectedOpenCodeConfigRoot);
  assert.equal(
    resolveDefaultClaudeCodeConfigRoot(),
    join(homeDirectory, ".claude"),
  );
  assert.equal(
    resolveDefaultCursorConfigRoot(),
    join(homeDirectory, ".cursor"),
  );
});

const require = createRequire(import.meta.url);

void test("safe path helpers sanitize ids and reject escaped real paths", async (context) => {
  const allowedRoot = await mkdtemp(join(tmpdir(), "agent-harness-safe-root-"));
  const outsideRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-safe-outside-"),
  );

  context.after(async () => {
    await rm(allowedRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });

  assert.equal(sanitizeMirrorId("@scope/pkg name"), "-scope-pkg-name");
  assert.match(sanitizeAssetId("!!!"), /^asset-[a-f0-9]{12}$/u);
  assert.match(
    sanitizeAssetId("github.copilot"),
    /^github-copilot-[a-f0-9]{12}$/u,
  );

  const nestedFile = join(allowedRoot, "nested", "asset.json");
  await mkdir(join(allowedRoot, "nested"), { recursive: true });
  await writeFile(nestedFile, "{}", "utf8");

  assert.equal(isPathWithinRoot(allowedRoot, allowedRoot), true);
  assert.equal(isPathWithinRoot(allowedRoot, nestedFile), true);
  assert.equal(isPathWithinRoot(allowedRoot, outsideRoot), false);

  assert.equal(resolveAllowedAbsolutePath("", [allowedRoot]), null);
  assert.equal(
    resolveAllowedAbsolutePath("relative/file.json", [allowedRoot]),
    null,
  );
  assert.equal(
    resolveAllowedAbsolutePath(nestedFile, [allowedRoot]),
    nestedFile,
  );
  assert.equal(resolveAllowedAbsolutePath(outsideRoot, [allowedRoot]), null);

  assert.equal(
    resolveSafeMirrorFilePath(allowedRoot, join("nested", "asset.json")),
    nestedFile,
  );
  assert.throws(
    () => resolveSafeMirrorFilePath(allowedRoot, "../escape.json", "read"),
    /Refusing to read mirrored artifact outside raw root/u,
  );
  assert.throws(
    () => resolveSafeMirrorFilePath(allowedRoot, "", "write"),
    /Refusing to write mirrored artifact outside raw root/u,
  );

  assert.equal(
    await resolveAllowedRealFilePath("relative/file.json", [allowedRoot]),
    null,
  );
  const realNestedFile = await realpath(nestedFile);
  assert.equal(
    await resolveAllowedRealFilePath(nestedFile, [allowedRoot]),
    realNestedFile,
  );
  assert.equal(
    await resolveAllowedRealFilePath(nestedFile, [
      join(outsideRoot, "missing"),
      allowedRoot,
    ]),
    realNestedFile,
  );
  assert.equal(
    await resolveAllowedRealFilePath(join(allowedRoot, "nested"), [
      allowedRoot,
    ]),
    null,
  );

  const outsideFile = join(outsideRoot, "secret.json");
  const linkedFile = join(allowedRoot, "linked-secret.json");
  await writeFile(outsideFile, '{"secret":true}', "utf8");
  await symlink(outsideFile, linkedFile);

  assert.equal(
    await resolveAllowedRealFilePath(linkedFile, [allowedRoot]),
    null,
  );

  const fsPromises = require("node:fs/promises") as typeof FsPromises;
  const originalRealpath = fsPromises.realpath;
  fsPromises.realpath = (async (
    pathValue: Parameters<typeof originalRealpath>[0],
    options?: Parameters<typeof originalRealpath>[1],
  ) => {
    if (String(pathValue) === allowedRoot) {
      const error = new Error("root disappeared") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return originalRealpath(pathValue, options as never);
  }) as typeof fsPromises.realpath;
  syncBuiltinESMExports();

  try {
    assert.equal(
      await resolveAllowedRealFilePath(nestedFile, [allowedRoot]),
      null,
    );
  } finally {
    fsPromises.realpath = originalRealpath;
    syncBuiltinESMExports();
  }

  fsPromises.realpath = (async (
    pathValue: Parameters<typeof originalRealpath>[0],
    options?: Parameters<typeof originalRealpath>[1],
  ) => {
    if (String(pathValue) === nestedFile) {
      const error = new Error("disappeared") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return originalRealpath(pathValue, options as never);
  }) as typeof fsPromises.realpath;
  syncBuiltinESMExports();

  try {
    assert.equal(
      await resolveAllowedRealFilePath(nestedFile, [allowedRoot]),
      null,
    );
  } finally {
    fsPromises.realpath = originalRealpath;
    syncBuiltinESMExports();
  }
});

void test("shared MCP asset ids are collected from active shared bundles and malformed bundles are skipped", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-shared-mcp-"),
  );
  context.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const activationManifest: ActivationManifest = {
    schemaVersion: 1,
    host: "shared",
    generatedAt: new Date().toISOString(),
    activeBundles: ["bundle-z", "bundle-a"],
    activeAssets: ["asset-z-mcp", "asset-a-mcp", "asset-plugin"],
    runtimeRoot: join(projectRoot, "activate", "shared"),
    notes: [],
  };
  await writeJsonFile(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    activationManifest,
  );

  const mcpPackageAPath = join(
    projectRoot,
    "packages",
    "asset-a-mcp.install.json",
  );
  const mcpPackageZPath = join(
    projectRoot,
    "packages",
    "asset-z-mcp.install.json",
  );
  const pluginPackagePath = join(
    projectRoot,
    "packages",
    "asset-plugin.install.json",
  );

  await Promise.all([
    writeInstalledPackageManifest(mcpPackageAPath, {
      assetId: "asset-a-mcp",
      assetKind: "mcp-server",
    }),
    writeInstalledPackageManifest(mcpPackageZPath, {
      assetId: "asset-z-mcp",
      assetKind: "mcp-server",
    }),
    writeInstalledPackageManifest(pluginPackagePath, {
      assetId: "asset-plugin",
      assetKind: "plugin",
    }),
    writeInstalledBundleManifest(projectRoot, "bundle-z", [
      {
        assetId: "asset-z-mcp",
        mirrorId: "mirror-z",
        manifestPath: mcpPackageZPath,
      },
      {
        assetId: "asset-plugin",
        mirrorId: "mirror-plugin",
        manifestPath: pluginPackagePath,
      },
    ]),
    writeInstalledBundleManifest(projectRoot, "bundle-a", [
      {
        assetId: "asset-a-mcp",
        mirrorId: "mirror-a",
        manifestPath: mcpPackageAPath,
      },
      {
        assetId: "asset-z-mcp",
        mirrorId: "mirror-z-duplicate",
        manifestPath: mcpPackageZPath,
      },
      {
        assetId: "asset-inactive-mcp",
        mirrorId: "mirror-inactive",
        manifestPath: join(
          projectRoot,
          "packages",
          "asset-inactive-mcp.install.json",
        ),
      },
    ]),
    writeInstalledPackageManifest(
      join(projectRoot, "packages", "asset-inactive-mcp.install.json"),
      {
        assetId: "asset-inactive-mcp",
        assetKind: "mcp-server",
      },
    ),
  ]);

  assert.deepEqual(await readSharedMcpAssetIds(projectRoot), [
    "asset-a-mcp",
    "asset-z-mcp",
  ]);

  const warningMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warningMessages.push(String(message ?? ""));
  };

  try {
    await writeJsonFile(
      join(projectRoot, "activate", "shared", "activation-manifest.json"),
      {
        ...activationManifest,
        activeBundles: ["bundle-broken"],
        activeAssets: ["asset-a-mcp"],
      },
    );
    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "shared",
        "bundles",
        "bundle-broken.install.json",
      ),
      {
        schemaVersion: 1,
        bundleId: "bundle-broken",
        host: "shared",
        installedAt: new Date().toISOString(),
        packages: "not-an-array",
      },
    );

    assert.deepEqual(await readSharedMcpAssetIds(projectRoot), []);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warningMessages.length, 1);
  assert.match(
    warningMessages[0] ?? "",
    /Skipping malformed shared install bundle manifest/u,
  );

  await writeJsonFile(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    {
      ...activationManifest,
      activeBundles: ["bundle-missing"],
      activeAssets: ["asset-a-mcp"],
    },
  );
  assert.deepEqual(await readSharedMcpAssetIds(projectRoot), []);
});

void test("path helpers can exercise darwin and linux host config branches", (context) => {
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.AGENT_HARNESS_HOME = "/tmp/agent-harness-home";
  process.env.APPDATA = "/tmp/agent-harness-appdata";
  process.env.XDG_CONFIG_HOME = "/tmp/agent-harness-xdg";
  clearRuntimeConfigForTests();

  context.after(() => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
  });

  withPatchedPlatform("win32", () => {
    assert.equal(
      resolveVsCodeUserSettingsPath(),
      join("/tmp/agent-harness-appdata", "Code", "User", "settings.json"),
    );
    assert.equal(
      resolveDefaultOpenCodeConfigRoot(),
      join("/tmp/agent-harness-appdata", "opencode"),
    );
  });

  delete process.env.APPDATA;
  clearRuntimeConfigForTests();
  withPatchedPlatform("win32", () => {
    assert.equal(
      resolveVsCodeUserSettingsPath(),
      join(
        "/tmp/agent-harness-home",
        "AppData",
        "Roaming",
        "Code",
        "User",
        "settings.json",
      ),
    );
    assert.equal(
      resolveDefaultOpenCodeConfigRoot(),
      join("/tmp/agent-harness-home", "AppData", "Roaming", "opencode"),
    );
  });
  process.env.APPDATA = "/tmp/agent-harness-appdata";
  clearRuntimeConfigForTests();

  withPatchedPlatform("darwin", () => {
    assert.equal(
      resolveVsCodeUserSettingsPath(),
      join(
        "/tmp/agent-harness-home",
        "Library",
        "Application Support",
        "Code",
        "User",
        "settings.json",
      ),
    );
    assert.equal(
      resolveDefaultOpenCodeConfigRoot(),
      join(
        "/tmp/agent-harness-home",
        "Library",
        "Application Support",
        "opencode",
      ),
    );
  });

  withPatchedPlatform("linux", () => {
    assert.equal(
      resolveVsCodeUserSettingsPath(),
      join("/tmp/agent-harness-xdg", "Code", "User", "settings.json"),
    );
    assert.equal(
      resolveDefaultOpenCodeConfigRoot(),
      join("/tmp/agent-harness-xdg", "opencode"),
    );
  });
});

void test("vscode and cursor native install actions ignore assets without valid VS Code extension ids", () => {
  const vscodeAdapter = resolveHostAdapter("vscode");
  assert.ok(vscodeAdapter?.nativeInstall);

  const vscodeActions = vscodeAdapter.nativeInstall.collectActions([
    buildCatalogAsset("valid extension", "extension", {
      manifestEntry: "publisher.valid-extension",
    }),
    buildCatalogAsset("invalid extension", "extension", {
      manifestEntry: "not a valid extension id",
    }),
  ]);

  assert.deepEqual(
    vscodeActions.map((action) => action.extensionId),
    ["publisher.valid-extension"],
  );
  assert.equal(vscodeActions[0]?.host, "copilot-vscode");
  assert.equal(vscodeActions[0]?.executable, "code");

  const cursorAdapter = resolveHostAdapter("cursor");
  assert.ok(cursorAdapter?.nativeInstall);

  const actions = cursorAdapter.nativeInstall.collectActions([
    buildCatalogAsset("valid extension", "extension", {
      manifestEntry: "publisher.valid-extension",
    }),
    buildCatalogAsset("invalid extension", "extension", {
      manifestEntry: "not a valid extension id",
    }),
    buildCatalogAsset("fallback extension", "extension"),
  ]);

  assert.deepEqual(
    actions.map((action) => action.extensionId),
    ["publisher.valid-extension"],
  );
  assert.equal(actions[0]?.host, "cursor");
  assert.equal(actions[0]?.executable, "cursor");
});

void test("host adapter registry normalizes custom adapters and honors capability-aware recommendation compatibility", () => {
  const before = listHostAdapters();
  before.pop();
  assert.equal(listHostAdapters().length >= before.length, true);

  const adapterId = "Agent-Harness-Test-Registry";
  const recommendationHost = "agent-harness-test-registry" as HostTarget;
  const firstAdapter = buildTestAdapter({
    id: adapterId,
    aliases: ["Test-Alias"],
    recommendationHost,
    capabilities: [{ assetKind: "skill", behaviors: ["wire"] }],
  });
  registerHostAdapter(firstAdapter);

  assert.equal(
    resolveHostAdapter("test-alias")?.id,
    "agent-harness-test-registry",
  );
  assert.equal(
    resolveHostAdapter("AGENT-HARNESS-TEST-REGISTRY")?.recommendationHost,
    recommendationHost,
  );

  registerHostAdapter({
    ...firstAdapter,
    id: adapterId.toLowerCase(),
    displayName: "Updated Test Host",
  });
  assert.equal(
    resolveHostAdapter("agent-harness-test-registry")?.displayName,
    "Updated Test Host",
  );

  assert.equal(
    isHostCompatibleWithRecommendationHost(
      ["opencode"],
      recommendationHost,
      "skill",
    ),
    true,
  );
  assert.equal(
    isHostCompatibleWithRecommendationHost(
      ["opencode"],
      recommendationHost,
      "plugin",
    ),
    false,
  );
  assert.equal(
    isHostCompatibleWithRecommendationHost(
      [recommendationHost],
      recommendationHost,
      "skill",
    ),
    true,
  );
  assert.equal(
    isHostCompatibleWithRecommendationHost(
      ["shared"],
      recommendationHost,
      "skill",
    ),
    false,
  );

  assert.throws(
    () =>
      registerHostAdapter(
        buildTestAdapter({
          id: "bad-registry-host",
          recommendationHost: "Bad Host" as HostTarget,
        }),
      ),
    /Invalid recommendation host identifier/u,
  );
});

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

async function writeInstalledBundleManifest(
  projectRoot: string,
  bundleId: string,
  packages: InstalledBundleManifest["packages"],
): Promise<void> {
  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "shared",
      "bundles",
      `${bundleId}.install.json`,
    ),
    {
      schemaVersion: 1,
      bundleId,
      host: "shared",
      installedAt: new Date().toISOString(),
      packages,
    } satisfies InstalledBundleManifest,
  );
}

async function writeInstalledPackageManifest(
  filePath: string,
  overrides: Pick<InstalledPackageManifest, "assetId" | "assetKind">,
): Promise<void> {
  await writeJsonFile(filePath, {
    schemaVersion: 1,
    assetId: overrides.assetId,
    mirrorId: `${overrides.assetId}-mirror`,
    host: "shared",
    installedAt: new Date().toISOString(),
    projectionType: "linked",
    assetKind: overrides.assetKind,
    sourceAuthorityTier: "trusted-local",
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    portfolioFit: 1,
    filesRoot: join(dirnameOrProject(filePath), overrides.assetId),
    bundleMembership: ["shared-bundle"],
    activationEligible: true,
    activeByDefault: true,
  } satisfies InstalledPackageManifest);
}

function dirnameOrProject(filePath: string): string {
  return filePath.slice(
    0,
    Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")),
  );
}

function buildCatalogAsset(
  id: string,
  assetKind: AssetCatalogEntry["assetKind"],
  overrides: { manifestEntry?: string } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind,
    hosts: ["cursor"],
    compatibilityMode: assetKind === "extension" ? "native" : "adaptable",
    source: {
      sourceId: `${id}-source`,
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 1,
      originUrl: `https://example.com/${id}`,
      publisher: "tests",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: [assetKind],
    install: {
      method: assetKind === "extension" ? "vscode-extension" : "local-file",
      nativeHosts: assetKind === "extension" ? ["cursor"] : undefined,
      adaptableHosts: assetKind === "extension" ? undefined : ["cursor"],
      manifestEntry: overrides.manifestEntry,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      rootPath: "/fixtures",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 1,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 1,
      hostFit: 1,
    },
    dedupe: {
      candidateRankHint: id,
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function withPatchedPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(descriptor);
  clearRuntimeConfigForTests();
  Object.defineProperty(process, "platform", {
    ...descriptor,
    value: platform,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    clearRuntimeConfigForTests();
  }
}

function buildTestAdapter(
  overrides: Partial<HostAdapter> &
    Pick<HostAdapter, "id" | "recommendationHost">,
): HostAdapter {
  return {
    id: overrides.id,
    aliases: overrides.aliases ?? [],
    displayName: overrides.displayName ?? "Test Host",
    lifecycleHost: overrides.lifecycleHost ?? "opencode",
    recommendationHost: overrides.recommendationHost,
    defaultBundleIds: overrides.defaultBundleIds ?? [],
    mutatesHostPaths: overrides.mutatesHostPaths ?? false,
    requiresLifecycleHostPaths: overrides.requiresLifecycleHostPaths,
    runtime: overrides.runtime,
    nativeInstall: overrides.nativeInstall,
    capabilities: overrides.capabilities ?? [
      { assetKind: "skill", behaviors: ["stage", "wire"] },
    ],
    wire: overrides.wire ?? (async () => {}),
  };
}
