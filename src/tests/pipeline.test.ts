import assert from "node:assert/strict";
import test from "node:test";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  acquireAllMirrorBatches,
  installBundleBatches,
  runWorkspacePipeline,
  type WorkspacePipelineDependencies,
} from "../pipeline.js";
import type { JsonValidator } from "../files.js";
import type { InstallProgressState, MirrorAcquireState } from "../types.js";

function createAcquireState(
  overrides: Partial<MirrorAcquireState> = {},
): MirrorAcquireState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 2,
    totalEligibleCount: 2,
    mirroredCount: 0,
    remainingCount: 2,
    skippedCount: 0,
    skippedAssetIds: [],
    skippedAssetReasons: {},
    lastBatchAssetIds: [],
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 0,
    lastBatchSkippedReasons: {},
    terminal: false,
    ...overrides,
  };
}

function createProgressState(
  bundleId: string,
  remainingAssets: number,
): InstallProgressState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    bundles: {
      [bundleId]: {
        host: "copilot-vscode",
        batchSize: 3,
        totalAssets: 3,
        installedAssets: 3 - remainingAssets,
        remainingAssets,
        lastBatchAssetIds: [bundleId],
      },
    },
  };
}

function buildDependencies(
  overrides: Partial<WorkspacePipelineDependencies> = {},
): WorkspacePipelineDependencies {
  const runtimeConfig = getRuntimeConfig();

  return {
    getRuntimeConfig: () => ({
      ...runtimeConfig,
      batches: {
        ...runtimeConfig.batches,
        mirrorAcquire: 2,
        installBundle: 3,
      },
    }),
    readJsonFileOrNull: async () => null,
    runDiscover: async () => {},
    runRecommend: async () => 0,
    runMirror: async () => {},
    runInstall: async () => {},
    runActivate: async () => {},
    writeWorkspaceProgress: () => {},
    ...overrides,
  };
}

void test("runWorkspacePipeline executes lifecycle phases in order and forwards session intents", async () => {
  const calls: string[] = [];
  const progressMessages: string[] = [];

  await runWorkspacePipeline(
    {
      projectRoot: "/project",
      workspaceRoot: "/workspace",
      targetHost: "copilot-vscode",
      recommendationHost: "cursor",
      sessionIntent: "backend",
      sessionIntents: ["backend", "testing"],
      bundleIds: ["copilot-core"],
    },
    buildDependencies({
      runDiscover: async (args) => {
        calls.push(`discover:${args.join(" ")}`);
      },
      runRecommend: async (args) => {
        calls.push(`recommend:${args.join(" ")}`);
        return 0;
      },
      runMirror: async (args) => {
        calls.push(`mirror:${args.join(" ")}`);
      },
      runInstall: async (args) => {
        calls.push(`install:${args.join(" ")}`);
      },
      runActivate: async (args) => {
        calls.push(`activate:${args.join(" ")}`);
      },
      readJsonFileOrNull: async <T>(path: string): Promise<T | null> => {
        if (path.endsWith("acquire-state.json")) {
          return createAcquireState({
            mirroredCount: 2,
            remainingCount: 0,
            terminal: true,
          }) as T;
        }

        if (path.endsWith("progress.json")) {
          return createProgressState("copilot-core", 0) as T;
        }

        return null;
      },
      writeWorkspaceProgress: (message) => {
        progressMessages.push(message);
      },
    }),
  );

  assert.deepEqual(calls, [
    "discover:demand-profile",
    "discover:sources",
    "discover:sync",
    "discover:sources",
    "discover:catalog",
    "discover:select",
    "recommend:report --intent backend --intent testing",
    "mirror:plan",
    "mirror:locks",
    "mirror:acquire --batch-size 2",
    "install:bundle --bundle copilot-core --batch-size 3",
    "install:reconcile",
    "activate:host --host copilot-vscode --recommendation-host cursor --intent backend",
    "activate:host --host shared --intent backend",
  ]);
  assert.ok(
    progressMessages.some((message) =>
      message.includes("[workspace] 1/11 Scanning workspace demand..."),
    ),
  );
  assert.ok(
    progressMessages.some((message) =>
      message.includes("mirror batch 1 acquiring artifacts"),
    ),
  );
  assert.ok(
    progressMessages.some((message) =>
      message.includes("install batch 1 for bundle 'copilot-core'"),
    ),
  );
});

void test("runWorkspacePipeline falls back to primary intent and default progress writer", async (t) => {
  const calls: string[] = [];
  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  t.after(() => {
    process.stdout.write = originalWrite;
  });

  await runWorkspacePipeline(
    {
      projectRoot: "/project",
      workspaceRoot: "/workspace",
      targetHost: "opencode",
      recommendationHost: "opencode",
      sessionIntent: "testing",
      sessionIntents: ["testing"],
      bundleIds: [],
    },
    {
      runDiscover: async (args) => {
        calls.push(`discover:${args.join(" ")}`);
      },
      runRecommend: async (args) => {
        calls.push(`recommend:${args.join(" ")}`);
        return 0;
      },
      runMirror: async (args) => {
        calls.push(`mirror:${args.join(" ")}`);
      },
      runInstall: async (args) => {
        calls.push(`install:${args.join(" ")}`);
      },
      runActivate: async (args) => {
        calls.push(`activate:${args.join(" ")}`);
      },
      readJsonFileOrNull: async <T>(path: string): Promise<T | null> => {
        if (path.endsWith("acquire-state.json")) {
          return createAcquireState({
            mirroredCount: 2,
            remainingCount: 0,
            terminal: true,
          }) as T;
        }
        return null;
      },
    },
  );

  assert.ok(stdout.includes("[workspace] 1/11 Scanning workspace demand..."));
  assert.ok(calls.includes("recommend:report --intent testing"));
  assert.ok(
    calls.includes(
      "activate:host --host opencode --recommendation-host opencode --intent testing",
    ),
  );
  assert.ok(calls.includes("activate:host --host shared --intent testing"));
});

void test("acquireAllMirrorBatches keeps acquiring until the checkpoint is complete", async () => {
  const progressMessages: string[] = [];
  const states = [
    createAcquireState({
      mirroredCount: 1,
      remainingCount: 1,
      lastBatchAssetIds: ["asset-a"],
      lastBatchMirroredCount: 1,
    }),
    createAcquireState({
      mirroredCount: 2,
      remainingCount: 0,
      lastBatchAssetIds: ["asset-b"],
      lastBatchMirroredCount: 1,
      terminal: true,
    }),
  ];
  let runMirrorCalls = 0;

  await acquireAllMirrorBatches(
    "/project",
    "/workspace",
    "25",
    buildDependencies({
      runMirror: async (args) => {
        runMirrorCalls += 1;
        assert.deepEqual(args, ["acquire", "--batch-size", "25"]);
      },
      readJsonFileOrNull: async <T>(): Promise<T | null> =>
        (states.shift() as T | undefined) ?? null,
      writeWorkspaceProgress: (message) => {
        progressMessages.push(message);
      },
    }),
  );

  assert.equal(runMirrorCalls, 2);
  assert.equal(
    progressMessages.filter((message) => message.includes("mirror batch"))
      .length,
    2,
  );
});

void test("acquireAllMirrorBatches surfaces missing persisted state", async () => {
  await assert.rejects(
    acquireAllMirrorBatches(
      "/project",
      "/workspace",
      "10",
      buildDependencies({
        readJsonFileOrNull: async () => null,
      }),
    ),
    /workspace pipeline missing mirror acquire state/u,
  );
});

void test("installBundleBatches keeps installing until each bundle is fully staged", async () => {
  const progressMessages: string[] = [];
  const statesByBundle = new Map<string, InstallProgressState[]>([
    [
      "copilot-core",
      [
        createProgressState("copilot-core", 1),
        createProgressState("copilot-core", 0),
      ],
    ],
    ["shared-mcp", [createProgressState("shared-mcp", 0)]],
  ]);
  const runInstallCalls: string[] = [];

  await installBundleBatches(
    "/project",
    "/workspace",
    ["copilot-core", "shared-mcp"],
    "40",
    buildDependencies({
      runInstall: async (args) => {
        runInstallCalls.push(args.join(" "));
      },
      readJsonFileOrNull: async <T>(): Promise<T | null> => {
        const currentCall = runInstallCalls.at(-1) ?? "";
        const bundleId = /--bundle ([^\s]+)/u.exec(currentCall)?.[1];
        return bundleId
          ? ((statesByBundle.get(bundleId)?.shift() as T | undefined) ?? null)
          : null;
      },
      writeWorkspaceProgress: (message) => {
        progressMessages.push(message);
      },
    }),
  );

  assert.deepEqual(runInstallCalls, [
    "bundle --bundle copilot-core --batch-size 40",
    "bundle --bundle copilot-core --batch-size 40",
    "bundle --bundle shared-mcp --batch-size 40",
  ]);
  assert.ok(
    progressMessages.some((message) =>
      message.includes("staging bundle 'copilot-core'"),
    ),
  );
  assert.ok(
    progressMessages.some((message) =>
      message.includes("staging bundle 'shared-mcp'"),
    ),
  );
});

void test("installBundleBatches validates persisted progress state", async () => {
  await assert.rejects(
    installBundleBatches(
      "/project",
      "/workspace",
      ["copilot-core"],
      "40",
      buildDependencies({
        readJsonFileOrNull: async <T>(
          _path: string,
          validator?: JsonValidator<T>,
        ): Promise<T | null> => {
          const value: unknown = { schemaVersion: "bad", bundles: {} };
          if (validator) {
            const validate: JsonValidator<T> = validator;
            validate(value, "install progress");
          }
          return value as T;
        },
      }),
    ),
    /workspace pipeline\.schemaVersion/u,
  );
});

void test("installBundleBatches rejects missing bundle progress", async () => {
  await assert.rejects(
    installBundleBatches(
      "/project",
      "/workspace",
      ["missing-bundle"],
      "40",
      buildDependencies({
        readJsonFileOrNull: async <T>(): Promise<T | null> =>
          createProgressState("other-bundle", 0) as T,
      }),
    ),
    /install bundle did not produce progress for bundle 'missing-bundle'/u,
  );
});

void test("installBundleBatches rejects missing progress state", async () => {
  await assert.rejects(
    installBundleBatches(
      "/project",
      "/workspace",
      ["copilot-core"],
      "40",
      buildDependencies({
        readJsonFileOrNull: async () => null,
      }),
    ),
    /install bundle did not produce progress state for bundle 'copilot-core'/u,
  );
});

void test("installBundleBatches rejects bundles that never finish within the batch cap", async () => {
  await assert.rejects(
    installBundleBatches(
      "/project",
      "/workspace",
      ["copilot-core"],
      "40",
      buildDependencies({
        readJsonFileOrNull: async <T>(): Promise<T | null> =>
          createProgressState("copilot-core", 1) as T,
      }),
    ),
    /install batching did not complete for bundle 'copilot-core' within the maximum batch count/u,
  );
});

// ── #349: pipeline fast-fails when recommend returns non-zero ─────────────

void test("runWorkspacePipeline throws when recommend phase returns non-zero exit code (#349)", async () => {
  // Simulate a workspace with 0 selected catalog entries — recommend fails.
  await assert.rejects(
    runWorkspacePipeline(
      {
        projectRoot: "/project",
        workspaceRoot: "/workspace",
        targetHost: "copilot-vscode",
        recommendationHost: "copilot-vscode",
        sessionIntent: "backend",
        bundleIds: [],
      },
      buildDependencies({
        runRecommend: async () => 1, // non-zero = failure
      }),
    ),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes("recommend phase failed") &&
        message.includes("discover full")
      );
    },
    "pipeline should throw a descriptive error when recommend returns non-zero",
  );
});
