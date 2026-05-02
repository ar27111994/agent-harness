#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { resolveHostAdapter } from "./host-adapters/registry.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runHostPreflight,
} from "./lib/preflight.js";
import { runWorkspacePipeline } from "./pipeline.js";

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
  const diagnostics = await runHostPreflight(hostAdapter.lifecycleHost, {
    requireHostPaths: requiresLifecycleHostPaths,
  });
  if (diagnostics.length > 0) {
    console.log(formatPreflightDiagnostics(diagnostics));
  }
  assertNoPreflightErrors(diagnostics);

  await runWorkspacePipeline({
    projectRoot,
    workspaceRoot: workingDirectory,
    targetHost: hostAdapter.lifecycleHost,
    sessionIntent,
    bundleIds: hostAdapter.defaultBundleIds,
  });
  await hostAdapter.wire({
    projectRoot,
    workspaceRoot: workingDirectory,
    mode: "apply",
  });
  return 0;
}

function printWorkspaceHelp(): void {
  console.log(`workspace commands:
  vscode    Run the full agent-harness pipeline for a VS Code / Copilot workspace
  opencode  Run the full agent-harness pipeline for an OpenCode workspace
  cursor       Run the Copilot-compatible pipeline and wire Cursor project files
  zed          Run the OpenCode-compatible pipeline and wire Zed project files
  claude-code  Run the OpenCode-compatible pipeline and wire Claude Code project files
  pi           Run the OpenCode-compatible pipeline and wire Pi project files

Options:
  --intent <general|frontend|backend|security|docs|testing>`);
}

function getOptionValue(
  args: string[],
  optionName: string,
): string | undefined {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
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
