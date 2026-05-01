#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { resolveHostAdapter } from "./host-adapters/registry.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runHostPreflight,
} from "./lib/preflight.js";

export async function runWire(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [target = "help", ...rest] = args;
  const mode = getWireMode(rest);

  if (target === "help") {
    printWireHelp();
    return 0;
  }

  const hostAdapter = resolveHostAdapter(target);
  if (!hostAdapter) {
    printWireHelp();
    return 1;
  }

  const diagnostics = await runHostPreflight(hostAdapter.lifecycleHost, {
    requireHostPaths: mode === "apply" && hostAdapter.mutatesHostPaths,
  });
  if (diagnostics.length > 0) {
    console.log(formatPreflightDiagnostics(diagnostics));
  }
  assertNoPreflightErrors(diagnostics);

  await hostAdapter.wire({
    projectRoot,
    workspaceRoot: workingDirectory,
    mode,
  });
  return 0;
}

function getWireMode(args: string[]): "preview" | "apply" | "reset" {
  if (args.includes("--reset")) {
    return "reset";
  }

  if (args.includes("--preview")) {
    return "preview";
  }

  return "apply";
}

function printWireHelp(): void {
  console.log(`wire commands:
  vscode    Preview/apply/reset VS Code user-scoped wiring and workspace instructions export
  opencode  Preview/apply/reset OpenCode project-local overlay export
  cursor       Emit Cursor adapter guidance through the host registry
  zed          Emit Zed adapter guidance through the host registry
  claude-code  Emit Claude Code adapter guidance through the host registry
  pi           Emit Pi adapter guidance through the host registry

Options:
  --preview
  --apply
  --reset`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , ...args] = process.argv;
  const projectRoot = resolveProjectRoot(fileURLToPath(import.meta.url));
  const workingDirectory = process.cwd();

  runWire(args, workingDirectory, projectRoot)
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
