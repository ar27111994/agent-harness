#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hasHelpFlag,
  isFlagLike,
  printUnknownArgumentError,
  rejectUnknownFlags,
} from "./cli-help-format.js";
import { resolveProjectRoot } from "./files.js";
import { getOptionValues } from "./lib/cli-options.js";
import {
  parseSessionIntent,
  SESSION_INTENT_CHOICES,
} from "./lib/session-intent.js";
import {
  orchestrateAiEnrichment,
  type AiEnrichmentOrchestrationResult,
} from "./domains/discovery/ai-enrichment.js";
import {
  listHostAdapters,
  resolveHostAdapter,
} from "./host-adapters/registry.js";
import { collectActivatedAssetPrerequisiteDiagnostics } from "./lib/asset-prerequisites.js";
import { printCommandHelp } from "./lib/cli-output.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runAdapterPreflight,
  runHostPreflight,
} from "./lib/preflight.js";
import { runWorkspacePipeline } from "./pipeline.js";

const WORKSPACE_KNOWN_FLAGS = new Set([
  "--intent",
  "--ai-enrich",
  "--no-ai-enrich",
  "--force",
  "--require-ai-enrich",
]);
const WORKSPACE_FLAGS_WITH_VALUES = new Set(["--intent"]);

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

  // Detect --help flag and show target-specific or parent help (#383).
  // Must precede any argument parsing that could throw on invalid flags.
  if (hasHelpFlag(rest)) {
    printWorkspaceSubcommandHelp(target);
    return 0;
  }

  const sessionIntents = getOptionValues(rest, "--intent").map((v) =>
    parseSessionIntent(v),
  );
  const sessionIntent =
    sessionIntents.length > 0
      ? sessionIntents[0]
      : parseSessionIntent(undefined);
  const aiEnrichmentFlags = parseAiEnrichmentFlags(rest);

  if (target === "help") {
    printWorkspaceHelp();
    return 0;
  }

  if (
    rejectUnknownFlags(
      rest,
      WORKSPACE_KNOWN_FLAGS,
      WORKSPACE_FLAGS_WITH_VALUES,
      "agent-harness workspace <host> --help",
    )
  ) {
    return 1;
  }

  const hostAdapter = resolveHostAdapter(target);
  if (!hostAdapter) {
    if (isFlagLike(target)) {
      printUnknownArgumentError(target);
      return 1;
    }
    printWorkspaceHelp();
    return 1;
  }

  console.log(
    `[workspace ${getPreferredHostCommand(hostAdapter.id)}] Starting ${hostAdapter.displayName} workspace pipeline...`,
  );

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
    sessionIntents: sessionIntents.length > 1 ? sessionIntents : undefined,
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

  console.log(
    `[workspace ${getPreferredHostCommand(hostAdapter.id)}] Applying final host wire-in...`,
  );
  await hostAdapter.wire({
    projectRoot,
    workspaceRoot: workingDirectory,
    mode: "apply",
  });

  console.log(
    `[workspace ${getPreferredHostCommand(hostAdapter.id)}] Final wire-in complete.`,
  );

  return handleAiEnrichmentResult(
    await orchestrateAiEnrichment(projectRoot, {
      trigger: "after-workspace",
      explicitRequested: aiEnrichmentFlags.explicitRequested,
      disableRequested: aiEnrichmentFlags.disableRequested,
      force: aiEnrichmentFlags.force,
      requireSuccess: aiEnrichmentFlags.requireSuccess,
    }),
  );
}

/**
 * Prints help for a specific workspace target or parent help (#383).
 */
function printWorkspaceSubcommandHelp(target: string): void {
  const hostAdapter = resolveHostAdapter(target);
  if (hostAdapter) {
    printCommandHelp({
      heading: `workspace ${getPreferredHostCommand(hostAdapter.id)} — Run full pipeline for ${hostAdapter.displayName}`,
      entries: [],
      sections: [
        {
          title: "",
          lines: [
            `Usage: agent-harness workspace ${getPreferredHostCommand(hostAdapter.id)} [--intent <intent>]`,
            "",
            `Runs the complete discover → recommend → mirror → stage → activate →`,
            `wire pipeline for ${hostAdapter.displayName}. All lifecycle state is`,
            `written under the configured state root.`,
            "",
            "Options:",
            "  --intent <intent>           Session intent (general, frontend, backend, etc.)",
            "  --force                     Force enrichment provider call, bypassing cache",
            "  --state-root <path>         Override state directory",
            "  --no-dotenv                 Skip .env file loading",
            "  --ai-enrich                 Request AI enrichment",
            "  --no-ai-enrich              Skip AI enrichment",
            "  --require-ai-enrich         Fail if AI enrichment is unavailable",
          ],
        },
      ],
    });
  } else {
    printWorkspaceHelp();
  }
}

function printWorkspaceHelp(): void {
  printCommandHelp({
    heading: "workspace commands:",
    entries: listHostAdapters().map((adapter) => ({
      command: getPreferredHostCommand(adapter.id),
      description: `Run the full pipeline and wire ${adapter.displayName}`,
    })),
    sections: [
      {
        title: "Options:",
        lines: [
          `--intent <${SESSION_INTENT_CHOICES}> Repeatable; multiple intents are merged additively`,
          "--ai-enrich         Explicitly request enrichment after workspace wiring",
          "--no-ai-enrich      Explicitly skip enrichment for this workspace run",
          "--force             Bypass cache reuse and automatic policy skips, forcing a new provider call when enrichment runs",
          "--require-ai-enrich Fail the command when enrichment does not complete or reuse successfully",
        ],
      },
    ],
  });
}

function parseAiEnrichmentFlags(args: readonly string[]): {
  explicitRequested: boolean;
  disableRequested: boolean;
  force: boolean;
  requireSuccess: boolean;
} {
  const explicitRequested = args.includes("--ai-enrich");
  const disableRequested = args.includes("--no-ai-enrich");
  const requireSuccess = args.includes("--require-ai-enrich");

  if (explicitRequested && disableRequested) {
    throw new Error("--ai-enrich and --no-ai-enrich cannot be used together.");
  }

  if (disableRequested && requireSuccess) {
    throw new Error(
      "--no-ai-enrich and --require-ai-enrich cannot be used together.",
    );
  }

  return {
    explicitRequested,
    disableRequested,
    force: args.includes("--force"),
    requireSuccess,
  };
}

function handleAiEnrichmentResult(
  result: AiEnrichmentOrchestrationResult,
): number {
  if (result.note) {
    console.log(result.note);
  }

  return result.shouldFail ? 1 : 0;
}

function getPreferredHostCommand(adapterId: string): string {
  return adapterId === "copilot-vscode" ? "vscode" : adapterId;
}

/**
 * Exposes workspace internals for focused test coverage.
 * Not part of the public API.
 */
export const workspaceInternals = {
  handleAiEnrichmentResult,
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
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
