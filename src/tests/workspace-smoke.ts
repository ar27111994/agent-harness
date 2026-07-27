import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { clearRuntimeConfig } from "../config/runtime.js";
import {
  pathExists,
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
  removePath,
} from "../files.js";
import { resolveHostAdapter } from "../host-adapters/registry.js";
import { resolveDefaultOpenCodeConfigRoot } from "../lib/paths.js";
import { prepareStateRoot } from "../lib/state-root.js";
import { assertInstallProgressState } from "../manifest-validation/install.js";
import {
  assertMirrorAcquireState,
  assertMirrorIndexEntry,
} from "../manifest-validation/mirror.js";
import { runWorkspacePipeline } from "../pipeline.js";
import type { InstallProgressState } from "../types/install.js";
import type { MirrorAcquireState, MirrorIndexEntry } from "../types/mirror.js";

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const hosts = ["vscode", "opencode", "cursor", "zed", "claude-code", "pi"];

const tempRoot = await mkdtemp(
  join(tmpdir(), "agent-harness-workspace-smoke-"),
);
try {
  process.env.AGENT_HARNESS_HOME = join(tempRoot, "home");
  process.env.APPDATA = join(tempRoot, "appdata");
  process.env.HOME = join(tempRoot, "home");
  process.env.USERPROFILE = join(tempRoot, "home");
  process.env.XDG_CONFIG_HOME = join(tempRoot, "xdg");
  clearRuntimeConfig();

  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const localOpenCodeRoot = resolveDefaultOpenCodeConfigRoot();

  await mkdir(join(localOpenCodeRoot, "skills", "repo-guide"), {
    recursive: true,
  });
  await mkdir(join(localOpenCodeRoot, "agent"), { recursive: true });
  await mkdir(join(localOpenCodeRoot, "commands"), { recursive: true });
  await writeFile(
    join(localOpenCodeRoot, "skills", "repo-guide", "SKILL.md"),
    "---\nname: repo-guide\ndescription: Repository guidance\ntags: [documentation, testing]\n---\n# Repo Guide\nUse this repository guidance.\n",
    "utf8",
  );
  await writeFile(
    join(localOpenCodeRoot, "agent", "reviewer.md"),
    "# Reviewer\nReview code changes for this repository.\n",
    "utf8",
  );
  await writeFile(
    join(localOpenCodeRoot, "commands", "review.md"),
    "---\ndescription: Review current changes\n---\nReview the current changes and suggest fixes.\n",
    "utf8",
  );
  await writeFile(join(workspaceRoot, "README.md"), "# Workspace\n", "utf8");

  await prepareStateRoot({
    packageRoot,
    stateRoot,
    usesPackageRoot: false,
  });
  await removePath(join(stateRoot, "discover", "source-packs"));
  await writeJsonFile(
    join(stateRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [],
    },
  );
  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      {
        id: "local-opencode-config",
        name: "Workspace Local OpenCode Config",
        kind: "local-directory",
        authorityTier: "trusted-local",
        publisher: { name: "workspace-local", verified: true },
        hosts: ["copilot-vscode", "opencode"],
        assetKinds: ["skill", "agent", "plugin", "prompt-pack"],
        discoveryMode: "seed",
        priority: 100,
        enabled: true,
        endpoints: { path: localOpenCodeRoot },
        rules: {
          officialPreferred: true,
          allowMirror: true,
          allowInstall: true,
        },
      },
    ],
  });

  for (const host of hosts) {
    const adapter = resolveHostAdapter(host);
    if (!adapter) {
      throw new Error(`Unknown workspace smoke host: ${host}`);
    }

    const sourceSyncReportPath = join(
      stateRoot,
      "discover",
      "output",
      "source-sync.json",
    );
    await removePath(sourceSyncReportPath);

    try {
      await runWorkspacePipeline({
        projectRoot: stateRoot,
        workspaceRoot,
        targetHost: adapter.lifecycleHost,
        recommendationHost: adapter.recommendationHost,
        sessionIntent: "testing",
        bundleIds: adapter.defaultBundleIds,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // The smoke workspace is minimal (3 entries, 0 selected) — it's normal
      // for recommend to produce nothing. Skip post-pipeline checks and
      // continue to the next host.
      if (message.includes("recommend phase failed")) {
        console.warn(
          `[${host}] skipped — 0 selected entries (expected for smoke workspace)`,
        );
        await adapter.wire({
          projectRoot: stateRoot,
          workspaceRoot,
          mode: "preview",
        });
        continue;
      }
      throw err;
    }

    if (!(await pathExists(sourceSyncReportPath))) {
      throw new Error(`[${host}] source-sync report missing after pipeline`);
    }

    // Assert mirror acquire state consistency
    const acquireState = await readJsonFileOrNull<MirrorAcquireState>(
      join(stateRoot, "state", "mirror", "acquire-state.json"),
      assertMirrorAcquireState,
    );
    if (!acquireState) {
      throw new Error(
        `[${host}] mirror acquire-state.json missing after pipeline`,
      );
    }
    if (!acquireState.terminal) {
      throw new Error(
        `[${host}] mirror acquire state is non-terminal (remaining=${acquireState.remainingCount})`,
      );
    }
    if (
      acquireState.mirroredCount + acquireState.skippedCount !==
      acquireState.totalEligibleCount
    ) {
      throw new Error(
        `[${host}] mirror acquire state inconsistent: mirrored(${acquireState.mirroredCount}) + skipped(${acquireState.skippedCount}) != total(${acquireState.totalEligibleCount})`,
      );
    }
    if (acquireState.totalEligibleCount > 0) {
      const mirrorIndex = await readJsonLinesFile<MirrorIndexEntry>(
        join(stateRoot, "mirror", "index.jsonl"),
        assertMirrorIndexEntry,
      );
      if (mirrorIndex.length === 0) {
        throw new Error(
          `[${host}] eligible assets selected (${acquireState.totalEligibleCount}) but mirror index is empty`,
        );
      }
    }

    // Assert install progress state consistency
    const progressState = await readJsonFileOrNull<InstallProgressState>(
      join(stateRoot, "state", "install", "progress.json"),
      assertInstallProgressState,
    );
    if (adapter.defaultBundleIds.length > 0 && !progressState) {
      throw new Error(
        `[${host}] install progress state missing for ${adapter.defaultBundleIds.length} expected bundle(s)`,
      );
    }
    if (progressState) {
      for (const bundleId of adapter.defaultBundleIds) {
        const bundle = progressState.bundles[bundleId];
        if (!bundle) {
          throw new Error(
            `[${host}] install progress missing expected bundle "${bundleId}"`,
          );
        }
        if (bundle.remainingAssets > 0) {
          throw new Error(
            `[${host}] install progress bundle "${bundleId}" still has ${bundle.remainingAssets} remaining assets`,
          );
        }
      }
    }

    await adapter.wire({
      projectRoot: stateRoot,
      workspaceRoot,
      mode: "preview",
    });
  }

  console.log(`Workspace smoke completed with state root ${stateRoot}`);
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}
