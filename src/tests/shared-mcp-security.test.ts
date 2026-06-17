/**
 * Security tests for readSharedMcpAssetIds path-containment fix (#318).
 *
 * Verifies that a tampered bundle manifest with a manifestPath pointing
 * outside the install root is rejected rather than read.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { readSharedMcpAssetIds } from "../lib/shared-mcp.js";
import type {
  InstalledBundleManifest,
  InstalledPackageManifest,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeActivationManifest(
  projectRoot: string,
  activeBundles: string[],
  activeAssets: string[],
): Promise<void> {
  await mkdir(join(projectRoot, "activate", "shared"), { recursive: true });
  await writeJsonFile(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    {
      schemaVersion: 1,
      host: "shared",
      runtimeRoot: join(projectRoot, "activate", "shared"),
      generatedAt: new Date().toISOString(),
      generationId: "gen-test",
      recommendationHost: "shared",
      activationBudget: 100,
      activeBundles,
      activeAssets,
      notes: [],
    },
  );
}

async function writeBundleManifest(
  projectRoot: string,
  bundleId: string,
  packages: InstalledBundleManifest["packages"],
): Promise<void> {
  await mkdir(join(projectRoot, "install", "shared", "bundles"), {
    recursive: true,
  });
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

async function writePackageManifest(
  filePath: string,
  assetId: string,
  assetKind: InstalledPackageManifest["assetKind"],
): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  const dir = filePath.slice(
    0,
    Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")),
  );
  await writeJsonFile(filePath, {
    schemaVersion: 1,
    assetId,
    mirrorId: `${assetId}-mirror`,
    host: "shared",
    installedAt: new Date().toISOString(),
    projectionType: "linked",
    assetKind,
    sourceAuthorityTier: "trusted-local",
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    portfolioFit: 1,
    filesRoot: join(dir, assetId),
    bundleMembership: ["shared-bundle"],
    activationEligible: true,
    activeByDefault: true,
  } satisfies InstalledPackageManifest);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void test("readSharedMcpAssetIds returns sorted mcp-server asset IDs from valid manifests", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-mcp-sec-valid-"));
  try {
    const projectRoot = join(tmp, "project");
    const pkgDir = join(projectRoot, "install", "shared", "pkgs");
    await mkdir(pkgDir, { recursive: true });

    const mcpPath = join(pkgDir, "mcp-1.json");
    const skillPath = join(pkgDir, "skill-1.json");

    await writeActivationManifest(
      projectRoot,
      ["bundle-a"],
      ["asset-mcp-1", "asset-skill-1"],
    );
    await writeBundleManifest(projectRoot, "bundle-a", [
      { assetId: "asset-mcp-1", mirrorId: "m1", manifestPath: mcpPath },
      { assetId: "asset-skill-1", mirrorId: "m2", manifestPath: skillPath },
    ]);
    await writePackageManifest(mcpPath, "asset-mcp-1", "mcp-server");
    await writePackageManifest(skillPath, "asset-skill-1", "skill");

    const result = await readSharedMcpAssetIds(projectRoot);
    assert.deepStrictEqual(result, ["asset-mcp-1"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

void test("readSharedMcpAssetIds skips packages whose manifestPath is outside install root (path traversal)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-mcp-sec-traversal-"));
  try {
    const projectRoot = join(tmp, "project");

    // Write a 'sensitive' file outside the install root
    const sensitiveDir = join(tmp, "outside");
    await mkdir(sensitiveDir, { recursive: true });
    const sensitivePath = join(sensitiveDir, "secrets.json");
    await writePackageManifest(sensitivePath, "tampered-asset", "mcp-server");

    await writeActivationManifest(
      projectRoot,
      ["bundle-evil"],
      ["tampered-asset"],
    );
    await writeBundleManifest(projectRoot, "bundle-evil", [
      {
        assetId: "tampered-asset",
        mirrorId: "evil-mirror",
        manifestPath: sensitivePath, // ← outside install root
      },
    ]);

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const result = await readSharedMcpAssetIds(projectRoot);
      assert.deepStrictEqual(result, [], "tampered path must be skipped");
      assert.ok(
        warnings.some(
          (w) => w.includes("tampered-asset") && w.includes("install root"),
        ),
        `Expected warning about install root, got: ${warnings.join("; ")}`,
      );
    } finally {
      console.warn = origWarn;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

void test("readSharedMcpAssetIds returns empty array when no activation manifest exists", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-mcp-sec-absent-"));
  try {
    const projectRoot = join(tmp, "empty-project");
    await mkdir(projectRoot, { recursive: true });
    const result = await readSharedMcpAssetIds(projectRoot);
    assert.deepStrictEqual(result, []);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

void test("readSharedMcpAssetIds ignores packages not in activeAssets", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-mcp-sec-inactive-"));
  try {
    const projectRoot = join(tmp, "project");
    const pkgDir = join(projectRoot, "install", "shared", "pkgs");
    await mkdir(pkgDir, { recursive: true });

    const mcpPath = join(pkgDir, "mcp-inactive.json");

    await writeActivationManifest(
      projectRoot,
      ["bundle-b"],
      [], // nothing active
    );
    await writeBundleManifest(projectRoot, "bundle-b", [
      {
        assetId: "asset-mcp-inactive",
        mirrorId: "m-inactive",
        manifestPath: mcpPath,
      },
    ]);
    await writePackageManifest(mcpPath, "asset-mcp-inactive", "mcp-server");

    const result = await readSharedMcpAssetIds(projectRoot);
    assert.deepStrictEqual(result, []);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

void test("readSharedMcpAssetIds returns IDs sorted alphabetically", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-mcp-sec-sort-"));
  try {
    const projectRoot = join(tmp, "project");
    const pkgDir = join(projectRoot, "install", "shared", "pkgs");
    await mkdir(pkgDir, { recursive: true });

    const pathZ = join(pkgDir, "z-mcp.json");
    const pathA = join(pkgDir, "a-mcp.json");

    await writeActivationManifest(
      projectRoot,
      ["bundle-sort"],
      ["z-mcp-asset", "a-mcp-asset"],
    );
    await writeBundleManifest(projectRoot, "bundle-sort", [
      { assetId: "z-mcp-asset", mirrorId: "mz", manifestPath: pathZ },
      { assetId: "a-mcp-asset", mirrorId: "ma", manifestPath: pathA },
    ]);
    await writePackageManifest(pathZ, "z-mcp-asset", "mcp-server");
    await writePackageManifest(pathA, "a-mcp-asset", "mcp-server");

    const result = await readSharedMcpAssetIds(projectRoot);
    assert.deepStrictEqual(result, ["a-mcp-asset", "z-mcp-asset"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
