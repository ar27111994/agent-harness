#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { getHostAdapter, listHostAdapters } from "./host-adapters/registry.js";
import { runWorkspacePipeline } from "./pipeline.js";
import { printPreflightDiagnostics, runPreflightChecks } from "./preflight.js";

export async function runWorkspace(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [target = "help", ...rest] = args;
  const sessionIntent = getOptionValue(rest, "--intent") ?? "general";
  const adapter = getHostAdapter(target);

  if (adapter) {
    printPreflightDiagnostics(
      await runPreflightChecks({ host: adapter.host, mode: "workspace" }),
    );
    await runWorkspacePipeline({
      projectRoot,
      workspaceRoot: workingDirectory,
      targetHost: adapter.host,
      sessionIntent,
      bundleIds: adapter.defaultBundleIds,
    });
    await adapter.wire({
      projectRoot,
      workspaceRoot: workingDirectory,
      mode: "apply",
    });
    return 0;
  }

  if (target === "help") {
    printWorkspaceHelp();
    return 0;
  }

  printWorkspaceHelp();
  return 1;
}

function printWorkspaceHelp(): void {
  const hostLines = listHostAdapters()
    .map(
      (adapter) =>
        `  ${adapter.cliName.padEnd(8)} Run the full pipeline for ${adapter.displayName}`,
    )
    .join("\n");
  console.log(`workspace commands:
${hostLines}

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
