#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { runWorkspacePipeline } from "./pipeline.js";
import { wireVsCode } from "./host-vscode.js";
import { wireOpenCode } from "./host-opencode.js";

export async function runWorkspace(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [target = "help", ...rest] = args;
  const sessionIntent = getOptionValue(rest, "--intent") ?? "general";

  switch (target) {
    case "vscode":
      await runWorkspacePipeline({
        projectRoot,
        workspaceRoot: workingDirectory,
        targetHost: "copilot-vscode",
        sessionIntent,
      });
      await wireVsCode({
        projectRoot,
        workspaceRoot: workingDirectory,
        mode: "apply",
      });
      return 0;
    case "opencode":
      await runWorkspacePipeline({
        projectRoot,
        workspaceRoot: workingDirectory,
        targetHost: "opencode",
        sessionIntent,
      });
      await wireOpenCode({
        projectRoot,
        workspaceRoot: workingDirectory,
        mode: "apply",
      });
      return 0;
    case "help":
      printWorkspaceHelp();
      return 0;
    default:
      printWorkspaceHelp();
      return 1;
  }
}

function printWorkspaceHelp(): void {
  console.log(`workspace commands:
  vscode    Run the full agent-harness pipeline for a VS Code / Copilot workspace
  opencode  Run the full agent-harness pipeline for an OpenCode workspace

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
