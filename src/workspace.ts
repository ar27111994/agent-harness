#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { getOptionValue } from "./lib/cli-options.js";
import {
  listHostAdapters,
  resolveHostAdapter,
} from "./host-adapters/registry.js";
import { collectActivatedAssetPrerequisiteDiagnostics } from "./lib/asset-prerequisites.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runAdapterPreflight,
  runHostPreflight,
} from "./lib/preflight.js";
import { runWorkspacePipeline } from "./pipeline.js";

/**
 * Runs the end-to-end lifecycle for a registered adapter and then applies its
 * host-specific workspace wire-in.
 */
export async function runWorkspace(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [target = "help", ...rest] = args;
  const sessionIntent = getOptionValue(rest, "--intent") ?? "general";

  if (target === "help") {
    printWorkspaceHelp();
    return 0;
  }

  const hostAdapter = resolveHostAdapter(target);
  if (!hostAdapter) {
    printWorkspaceHelp();
    return 1;
  }

  const requiresLifecycleHostPaths =
    hostAdapter.requiresLifecycleHostPaths ?? hostAdapter.mutatesHostPaths;
  const diagnostics = [
    ...(await runHostPreflight(hostAdapter.lifecycleHost, {
      requireHostPaths: requiresLifecycleHostPaths,
    })),
    ...(await runAdapterPreflight(hostAdapter)),
  ];
  if (diagnostics.length > 0) {
    console.log(formatPreflightDiagnostics(diagnostics));
  }
  assertNoPreflightErrors(diagnostics);

  await runWorkspacePipeline({
    projectRoot,
    workspaceRoot: workingDirectory,
    targetHost: hostAdapter.lifecycleHost,
    recommendationHost: hostAdapter.recommendationHost,
    sessionIntent,
    bundleIds: hostAdapter.defaultBundleIds,
  });

  const prerequisiteDiagnostics =
    await collectActivatedAssetPrerequisiteDiagnostics(
      projectRoot,
      hostAdapter,
      { missingEnvSeverity: "error" },
    );
  if (prerequisiteDiagnostics.length > 0) {
    console.log(formatPreflightDiagnostics(prerequisiteDiagnostics));
  }
  assertNoPreflightErrors(prerequisiteDiagnostics);

  await hostAdapter.wire({
    projectRoot,
    workspaceRoot: workingDirectory,
    mode: "apply",
  });
  return 0;
}

function printWorkspaceHelp(): void {
  const commands = listHostAdapters()
    .map(
      (adapter) =>
        `  ${getPreferredHostCommand(adapter.id).padEnd(12)} Run the full pipeline and wire ${adapter.displayName}`,
    )
    .join("\n");
  console.log(`workspace commands:
${commands}

Options:
  --intent <general|frontend|backend|security|docs|testing>`);
}

function getPreferredHostCommand(adapterId: string): string {
  return adapterId === "copilot-vscode" ? "vscode" : adapterId;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , ...args] = process.argv;
  const projectRoot = resolveProjectRoot(fileURLToPath(import.meta.url));
  const workingDirectory = process.cwd();

  runWorkspace(args, workingDirectory, projectRoot)
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
