import { acquireMirrorArtifacts } from "./mirror/acquire.js";
import { generateBundleLocks } from "./mirror/bundles.js";
import {
  diffMirrorIndex,
  explainBundleLock,
  explainMirrorArtifact,
} from "./mirror/inspect.js";
import { generateMirrorPlan } from "./mirror/plan.js";
import {
  handleUnknownCommand,
  hasHelpFlag,
  hasUnknownFlagsForSubcommands,
  printSubcommandHelp,
  type SubcommandFlagSpec,
  type SubcommandHelpEntry,
} from "./cli-help-format.js";
import { printCommandHelp } from "./lib/cli-output.js";

/**
 * Re-exports safe mirror path resolution for tests and mirror callers.
 */
export { resolveSafeMirrorFilePath } from "./lib/safe-paths.js";
/**
 * Re-exports mirror evidence path guards for tests and mirror callers.
 */
export {
  resolveAllowedMirrorEvidenceFilePath,
  resolveAllowedMirrorEvidenceFilePathForRead,
} from "./mirror/paths.js";

/**
 * Flag spec table for mirror subcommands (#445): the shared unknown-flag
 * guard rejects typo'd flags before any mirror work or state write.
 */
const MIRROR_SUBCOMMAND_FLAG_SPECS: Record<string, SubcommandFlagSpec> = {
  plan: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness mirror plan --help",
  },
  locks: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness mirror locks --help",
  },
  acquire: {
    knownFlags: new Set(["--batch-size"]),
    flagsWithValues: new Set(["--batch-size"]),
    usageHint: "agent-harness mirror acquire --help",
  },
  diff: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness mirror diff --help",
  },
  "bundle-explain": {
    knownFlags: new Set(["--bundle", "--json"]),
    flagsWithValues: new Set(["--bundle"]),
    usageHint: "agent-harness bundle explain --help",
  },
  "explain-bundle": {
    knownFlags: new Set(["--bundle", "--json"]),
    flagsWithValues: new Set(["--bundle"]),
    usageHint: "agent-harness bundle explain --help",
  },
  explain: {
    knownFlags: new Set(["--asset", "--mirror"]),
    flagsWithValues: new Set(["--asset", "--mirror"]),
    usageHint: "agent-harness mirror explain --help",
  },
};

/**
 * Dispatches the mirror CLI command group.
 */
export async function runMirror(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  // Detect --help flag and show subcommand-specific help (#383).
  if (hasHelpFlag(rest)) {
    printMirrorSubcommandHelp(command);
    return 0;
  }

  // Strict flag validation before any mirror work (#445).
  if (
    hasUnknownFlagsForSubcommands(MIRROR_SUBCOMMAND_FLAG_SPECS, command, rest)
  ) {
    return 1;
  }

  switch (command) {
    case "plan":
      await generateMirrorPlan(projectRoot);
      return 0;
    case "locks":
      await generateBundleLocks(projectRoot);
      return 0;
    case "acquire":
      await acquireMirrorArtifacts(projectRoot, workingDirectory, rest);
      return 0;
    case "diff":
      await diffMirrorIndex(projectRoot);
      return 0;
    case "bundle-explain":
      await explainBundleLock(projectRoot, rest);
      return 0;
    case "explain-bundle":
      await explainBundleLock(projectRoot, rest);
      return 0;
    case "explain":
      await explainMirrorArtifact(projectRoot, rest);
      return 0;
    case "help":
      printMirrorHelp();
      return 0;
    default:
      return handleUnknownCommand(command, printMirrorHelp);
  }
}

function printMirrorHelp(): void {
  printCommandHelp({
    heading: "mirror commands:",
    entries: [
      {
        command: "plan",
        description:
          "Summarize mirror readiness into mirror/audit/mirror-plan.json",
      },
      {
        command: "locks",
        description:
          "Generate initial bundle lock files from selected catalog entries",
      },
      {
        command: "acquire",
        description:
          "Acquire raw mirror artifacts, write mirror index, and resolve bundle locks",
      },
      {
        command: "diff",
        description:
          "Compare current mirror index to the previous mirror index snapshot",
      },
      {
        command: "bundle-explain",
        description:
          "Explain why assets are present in a bundle lock by --bundle <bundleId>",
      },
      {
        command: "explain-bundle",
        description: "Alias for bundle-explain",
      },
      {
        command: "explain",
        description:
          "Explain a mirrored artifact by --asset <assetId> or --mirror <mirrorId>",
      },
    ],
  });
}

/**
 * Prints help for a specific mirror subcommand (#383).
 */
function printMirrorSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    locks: {
      heading: "mirror locks — Generate bundle lock files",
      lines: [
        "Usage: agent-harness mirror locks",
        "",
        "Generates lock files for each mirror bundle in mirror/bundles/.",
        "Lock files record the exact asset set and versions pinned for",
        "reproducible mirror acquisition.",
        "",
        "Output: mirror/bundles/*.lock.json",
      ],
    },
    plan: {
      heading: "mirror plan — Summarize mirror readiness",
      lines: [
        "Usage: agent-harness mirror plan",
        "",
        "Summarizes mirror readiness by cross-referencing selected catalog",
        "entries against existing mirrors and bundle locks.",
        "",
        "Output: mirror/audit/mirror-plan.json",
      ],
    },
    acquire: {
      heading: "mirror acquire — Download mirror artifacts",
      lines: [
        "Usage: agent-harness mirror acquire [--batch-size <n>]",
        "",
        "Acquires raw mirror artifacts, writes the mirror index, and resolves",
        "bundle locks for all bundles.",
        "",
        "Options:",
        "  --batch-size <n>   Max artifacts per batch (default: 120)",
      ],
    },
    diff: {
      heading: "mirror diff — Compare mirror indices",
      lines: [
        "Usage: agent-harness mirror diff",
        "",
        "Compares the current mirror index against the previous snapshot,",
        "reporting added, removed, and changed artifacts.",
      ],
    },
    explain: {
      heading: "mirror explain — Explain a mirrored artifact",
      lines: [
        "Usage: agent-harness mirror explain --asset <assetId>",
        "       agent-harness mirror explain --mirror <mirrorId>",
        "",
        "Prints provenance information for a specific mirrored artifact.",
      ],
    },
    "bundle-explain": {
      heading:
        "bundle explain — Explain why assets are present in a bundle lock",
      lines: [
        "Usage: agent-harness bundle explain --bundle <bundleId>",
        "       agent-harness bundle explain <bundleId>",
        "       agent-harness mirror bundle-explain --bundle <bundleId>",
        "       agent-harness mirror bundle-explain <bundleId>",
        "",
        "Prints detailed bundle membership and provenance for a mirrored",
        "artifact, including which bundles reference it and its acquisition status.",
        "",
        "Alias: mirror bundle-explain",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printMirrorHelp);
}
