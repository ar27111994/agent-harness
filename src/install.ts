import { installBundles } from "./install/bundle.js";
import {
  diffInstallState,
  explainInstalledAsset,
  manageInstallGenerations,
} from "./install/generations.js";
import { manageNativeInstall } from "./install/native.js";
import { manageInstallRefresh } from "./install/refresh.js";
import { reconcileInstallState, resetInstallState } from "./install/state.js";
import {
  hasHelpFlag,
  printSubcommandHelp,
  type SubcommandHelpEntry,
} from "./cli-help-format.js";
import { printCommandHelp } from "./lib/cli-output.js";
import { getOptionValue } from "./lib/cli-options.js";

/**
 * Dispatches the install CLI command group.
 */
export async function runInstall(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  // Detect --help flag and show subcommand-specific help (#383).
  if (hasHelpFlag(rest)) {
    printInstallSubcommandHelp(command);
    return 0;
  }

  switch (command) {
    case "bundle":
      await installBundles(projectRoot, rest);
      return 0;
    case "native":
      await manageNativeInstall(projectRoot, rest);
      return 0;
    case "refresh":
      await manageInstallRefresh(projectRoot, workingDirectory, rest);
      return 0;
    case "reconcile":
      await reconcileInstallState(projectRoot, getOptionValue(rest, "--host"));
      return 0;
    case "diff":
      await diffInstallState(projectRoot, rest);
      return 0;
    case "explain":
      await explainInstalledAsset(projectRoot, rest);
      return 0;
    case "generations":
      await manageInstallGenerations(projectRoot, rest);
      return 0;
    case "reset":
      await resetInstallState(projectRoot, getOptionValue(rest, "--host"));
      return 0;
    case "help":
      printInstallHelp();
      return 0;
    default:
      printInstallHelp();
      return 1;
  }
}

function printInstallHelp(): void {
  printCommandHelp({
    heading: "install commands (stage is a legacy alias):",
    entries: [
      {
        command: "bundle",
        description: "Stage mirrored assets from mirror bundle locks",
      },
      {
        command: "native",
        description: "Plan/verify/apply/remove host-native installs",
      },
      {
        command: "refresh",
        description:
          "Refresh staged install state and report/apply stale assets",
      },
      {
        command: "reconcile",
        description:
          "Recompute staged install progress from bundle install manifests",
      },
      {
        command: "diff",
        description:
          "Compare current vs previous or explicit install generations",
      },
      {
        command: "explain",
        description: "Explain where a staged asset is present and active",
      },
      {
        command: "generations",
        description: "Manage generation list, pinning, and pruning",
      },
      {
        command: "reset",
        description:
          "Remove staged install state, packages, bundles, and generations",
      },
    ],
    sections: [
      {
        title: "Native install options:",
        lines: [
          "--host <vscode|opencode|cursor|zed|claude-code|pi>",
          "--operation <plan|install|verify|remove>",
          "--apply     Required for mutating install/remove operations",
        ],
      },
      {
        title: "Install refresh options:",
        lines: [
          "--host <copilot-vscode|opencode|shared>",
          "--apply             Apply eligible stale bundle refreshes after reporting",
          "--due-only          Skip the run unless the persisted refresh interval says a check is due",
          "--no-mirror-refresh Skip the explicit mirror refresh step and report from current local state only",
        ],
      },
    ],
  });
}

/**
 * Prints help for a specific install/stage subcommand (#383).
 */
function printInstallSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    bundle: {
      heading: "install bundle — Stage mirrored assets from bundle locks",
      lines: [
        "Usage: agent-harness install bundle [--batch-size <n>] [--host <host>]",
        "",
        "Stages mirrored assets from bundle lock files into lifecycle-host",
        "package stores. Reads mirror/bundles/*.lock.json and writes staged",
        "assets to the install directory.",
        "",
        "Options:",
        "  --host <host>        Target host (default: all bundles)",
        "  --batch-size <n>     Max assets per batch (default: 250)",
        "",
        "Alias: stage bundle",
      ],
    },
    refresh: {
      heading: "install refresh — Refresh staged install state",
      lines: [
        "Usage: agent-harness install refresh [--host <host>] [--apply]",
        "",
        "Refreshes staged install state by checking mirror bundles for updates.",
        "Reports stale assets and optionally applies updates.",
        "",
        "Options:",
        "  --host <host>     Target host",
        "  --apply           Apply eligible stale bundle refreshes",
        "  --due-only        Skip unless refresh interval says a check is due",
        "  --no-mirror-refresh  Skip explicit mirror refresh step",
      ],
    },
    native: {
      heading: "install native — Host-native install operations",
      lines: [
        "Usage: agent-harness install native --host <host> --operation <op> [--apply]",
        "",
        "Manages host-native installs (VS Code extensions, npm packages, etc.).",
        "",
        "Options:",
        "  --host <host>                           Target host",
        "  --operation <plan|install|verify|remove>  Operation to perform",
        "  --apply                                 Required for mutating operations",
      ],
    },
    reconcile: {
      heading: "install reconcile — Reconcile staged install state",
      lines: [
        "Usage: agent-harness install reconcile [--host <host>]",
        "",
        "Reconciles staged install state against mirror bundles, detecting",
        "drift between what is staged and what is available.",
      ],
    },
    diff: {
      heading: "install diff — Show install state differences",
      lines: [
        "Usage: agent-harness install diff [--host <host>] [--left <genId>] [--right <genId>]",
        "",
        "Shows differences between staged install state and mirror bundles.",
        "Optionally compare two specific generations via --left and --right.",
      ],
    },
    explain: {
      heading: "install explain — Explain an install decision",
      lines: [
        "Usage: agent-harness install explain --asset <assetId>",
        "",
        "Explains why a specific asset was installed, updated, or skipped.",
      ],
    },
    generations: {
      heading: "install generations — Manage install generation records",
      lines: [
        "Usage:",
        "  agent-harness install generations list [--host <host>]",
        "  agent-harness install generations pin --host <host> --generation <genId> [--reason <text>]",
        "  agent-harness install generations unpin --host <host> --generation <genId>",
        "  agent-harness install generations prune --host <host> [--keep <n>]",
        "",
        "Subcommands:",
        "  list     List historical install generation records with timestamps",
        "  pin      Pin a generation to prevent it from being pruned",
        "  unpin    Remove a pin from a previously pinned generation",
        "  prune    Remove old generations, keeping the most recent N (default: 2)",
        "",
        "Use 'install diff' to compare specific generations.",
      ],
    },
    reset: {
      heading: "install reset — Reset install state",
      lines: [
        "Usage: agent-harness install reset [--host <host>]",
        "",
        "Resets install state to a clean baseline, removing all staged assets.",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printInstallHelp);
}
