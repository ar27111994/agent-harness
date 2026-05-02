#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
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

/**
 * Dispatches host wire preview/apply/reset commands through the adapter
 * registry after lifecycle and adapter readiness diagnostics run.
 */
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

  const requiresLifecycleHostPaths =
    hostAdapter.requiresLifecycleHostPaths ?? hostAdapter.mutatesHostPaths;
  const diagnostics = [
    ...(await runHostPreflight(hostAdapter.lifecycleHost, {
      requireHostPaths: mode !== "preview" && requiresLifecycleHostPaths,
    })),
    ...(await runAdapterPreflight(hostAdapter)),
    ...(mode === "reset"
      ? []
      : await collectActivatedAssetPrerequisiteDiagnostics(
          projectRoot,
          hostAdapter,
          {
            missingEnvSeverity: mode === "preview" ? "warning" : "error",
          },
        )),
  ];
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

/**
 * Resolves mutually-exclusive wire mode flags, defaulting to preview.
 */
export function getWireMode(args: string[]): "preview" | "apply" | "reset" {
  const modeFlags = ["--reset", "--preview", "--apply"].filter((flag) =>
    args.includes(flag),
  );

  if (modeFlags.length > 1) {
    throw new Error(`Conflicting wire mode flags: ${modeFlags.join(", ")}`);
  }

  if (modeFlags[0] === "--reset") {
    return "reset";
  }

  if (modeFlags[0] === "--preview") {
    return "preview";
  }

  if (modeFlags[0] === "--apply") {
    return "apply";
  }

  return "preview";
}

function printWireHelp(): void {
  const commands = listHostAdapters()
    .map(
      (adapter) =>
        `  ${getPreferredHostCommand(adapter.id).padEnd(12)} Preview/apply/reset ${adapter.displayName}`,
    )
    .join("\n");
  console.log(`wire commands:
${commands}

Options:
  --preview (default)
  --apply
  --reset`);
}

function getPreferredHostCommand(adapterId: string): string {
  return adapterId === "copilot-vscode" ? "vscode" : adapterId;
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
