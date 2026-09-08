#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  hasHelpFlag,
  isFlagLike,
  printUnknownArgumentError,
  hasUnknownFlag,
  CliUsageError,
} from "./cli-help-format.js";
import { resolveProjectRoot } from "./files.js";
import {
  listHostAdapters,
  resolveHostAdapter,
} from "./host-adapters/registry.js";
import { collectActivatedAssetPrerequisiteDiagnostics } from "./lib/asset-prerequisites.js";
import { printCommandHelp } from "./lib/cli-output.js";
import {
  formatActionableDiagnostic,
  unknownHostDiagnostic,
} from "./lib/diagnostics.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runAdapterPreflight,
  runHostPreflight,
} from "./lib/preflight.js";

class WireModeUsageError extends CliUsageError {
  public constructor(message: string) {
    super(message, "agent-harness wire <host> --help");
    this.name = "WireModeUsageError";
  }
}

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

  // Detect --help flag and show target-specific or parent help (#383).
  // Must precede any argument parsing that could throw on invalid flags.
  if (hasHelpFlag(rest)) {
    printWireSubcommandHelp(target);
    return 0;
  }

  let mode: "preview" | "apply" | "reset";
  try {
    mode = getWireMode(rest);
  } catch (error: unknown) {
    if (error instanceof WireModeUsageError) {
      console.error(
        `error: ${error.message} Run '${error.usageHint}' for usage.`,
      );
      return 1;
    }
    throw error;
  }

  if (target === "help") {
    printWireHelp();
    return 0;
  }

  const hostAdapter = resolveHostAdapter(target);
  if (!hostAdapter) {
    if (isFlagLike(target)) {
      printUnknownArgumentError(target);
      return 1;
    }
    console.log(formatActionableDiagnostic(unknownHostDiagnostic(target)));
    printWireHelp();
    return 1;
  }

  // Strict flag validation before any preflight work (#431): wire hosts only
  // accept the three mode flags.
  if (
    hasUnknownFlag(
      rest,
      new Set(["--preview", "--apply", "--reset"]),
      new Set(),
      `agent-harness wire ${getPreferredHostCommand(hostAdapter.id)} --help`,
    )
  ) {
    return 1;
  }

  // requiresLifecycleHostPaths is optional on HostAdapter; the fallback is
  // live behavior for adapters that only declare mutatesHostPaths.
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
  let optionsEnded = false;
  const supportedModes = new Set(["preview", "apply", "reset"]);
  for (const argument of args) {
    if (argument === "--") {
      optionsEnded = true;
      continue;
    }
    if (optionsEnded || !isFlagLike(argument)) {
      const message =
        !optionsEnded && supportedModes.has(argument)
          ? `Positional wire mode '${argument}' is not supported; use '--${argument}' instead.`
          : `Unexpected positional argument '${argument}'; wire modes must be passed as '--preview', '--apply', or '--reset'.`;
      throw new WireModeUsageError(message);
    }
  }

  const modeFlags = ["--reset", "--preview", "--apply"].filter((flag) =>
    args.includes(flag),
  );

  if (modeFlags.length > 1) {
    throw new WireModeUsageError(
      `Conflicting wire mode flags: ${modeFlags.join(", ")}; choose exactly one.`,
    );
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

/** Runs the direct wire CLI entrypoint and preserves unexpected error stacks. */
export async function runWireEntrypoint(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
  dispatch: (
    args: string[],
    workingDirectory: string,
    projectRoot: string,
  ) => Promise<number> = runWire,
): Promise<void> {
  try {
    const exitCode = await dispatch(args, workingDirectory, projectRoot);
    process.exitCode = exitCode;
  } catch (error: unknown) {
    // Wire never throws CliUsageError (user-input failures return exit
    // codes); any rejection here is a genuine bug and keeps its stack.
    console.error(error);
    process.exitCode = 1;
  }
}

/**
 * Prints help for a specific wire target or parent help (#383).
 */
function printWireSubcommandHelp(target: string): void {
  const hostAdapter = resolveHostAdapter(target);
  if (hostAdapter) {
    printCommandHelp({
      heading: `wire ${getPreferredHostCommand(hostAdapter.id)} — Wire activated assets into ${hostAdapter.displayName}`,
      entries: [],
      sections: [
        {
          title: "",
          lines: [
            `Usage: agent-harness wire ${getPreferredHostCommand(hostAdapter.id)} [--preview|--apply|--reset]`,
            "",
            `Wires activated assets into a ${hostAdapter.displayName} workspace.`,
            `By default runs in preview mode (no files are written).`,
            "",
            "Options:",
            "  --preview          Preview the wire plan without applying (default)",
            "  --apply            Apply the wire plan to the workspace",
            "  --reset            Reset the wire configuration to defaults",
            "  --state-root <path>  Override state directory",
          ],
        },
      ],
    });
  } else {
    printWireHelp();
  }
}

function printWireHelp(): void {
  printCommandHelp({
    heading: "wire commands:",
    entries: listHostAdapters().map((adapter) => ({
      command: getPreferredHostCommand(adapter.id),
      description: `Preview/apply/reset ${adapter.displayName}`,
    })),
    sections: [
      {
        title: "Options:",
        lines: ["--preview (default)", "--apply", "--reset"],
      },
    ],
  });
}

function getPreferredHostCommand(adapterId: string): string {
  return adapterId === "copilot-vscode" ? "vscode" : adapterId;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , ...args] = process.argv;
  const projectRoot = resolveProjectRoot(fileURLToPath(import.meta.url));
  const workingDirectory = process.cwd();

  void runWireEntrypoint(args, workingDirectory, projectRoot);
}
