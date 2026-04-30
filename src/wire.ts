#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { getHostAdapter, listHostAdapters } from "./host-adapters/registry.js";
import { printPreflightDiagnostics, runPreflightChecks } from "./preflight.js";

export async function runWire(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [target = "help", ...rest] = args;
  const mode = getWireMode(rest);
  const adapter = getHostAdapter(target);

  if (adapter) {
    printPreflightDiagnostics(
      await runPreflightChecks({ host: adapter.host, mode }),
    );
    await adapter.wire({ projectRoot, workspaceRoot: workingDirectory, mode });
    return 0;
  }

  if (target === "help") {
    printWireHelp();
    return 0;
  }

  printWireHelp();
  return 1;
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
  const hostLines = listHostAdapters()
    .map(
      (adapter) =>
        `  ${adapter.cliName.padEnd(8)} Preview/apply/reset ${adapter.displayName} wire-in`,
    )
    .join("\n");
  console.log(`wire commands:
${hostLines}

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
