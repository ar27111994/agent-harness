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
      await reconcileInstallState(projectRoot);
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
      await resetInstallState(projectRoot);
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
    heading: "stage commands (install is a supported alias):",
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
        title: "Stage refresh options:",
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
      heading: "stage bundle — Stage mirrored assets from bundle locks",
      lines: [
        "Usage: agent-harness stage bundle [--batch-size <n>] [--host <host>]",
        "",
        "Stages mirrored assets from bundle lock files into lifecycle-host",
        "package stores. Reads mirror/bundles/*.lock.json and writes staged",
        "assets to the install directory.",
        "",
        "Options:",
        "  --host <host>        Target host (default: all bundles)",
        "  --batch-size <n>     Max assets per batch (default: 250)",
        "",
        "Alias: install bundle",
      ],
    },
    refresh: {
      heading: "stage refresh — Refresh staged install state",
      lines: [
        "Usage: agent-harness stage refresh [--host <host>] [--apply]",
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
      heading: "stage native — Host-native install operations",
      lines: [
        "Usage: agent-harness stage native --host <host> --operation <op> [--apply]",
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
      heading: "stage reconcile — Reconcile staged install state",
      lines: [
        "Usage: agent-harness stage reconcile [--host <host>]",
        "",
        "Reconciles staged install state against mirror bundles, detecting",
        "drift between what is staged and what is available.",
      ],
    },
    diff: {
      heading: "stage diff — Show install state differences",
      lines: [
        "Usage: agent-harness stage diff [--host <host>]",
        "",
        "Shows differences between staged install state and mirror bundles.",
      ],
    },
    explain: {
      heading: "stage explain — Explain an install decision",
      lines: [
        "Usage: agent-harness stage explain --asset <assetId>",
        "",
        "Explains why a specific asset was installed, updated, or skipped.",
      ],
    },
    generations: {
      heading: "stage generations — List install generations",
      lines: [
        "Usage: agent-harness stage generations [--host <host>]",
        "",
        "Lists historical install generation records with timestamps.",
      ],
    },
    reset: {
      heading: "stage reset — Reset install state",
      lines: [
        "Usage: agent-harness stage reset [--host <host>]",
        "",
        "Resets install state to a clean baseline, removing all staged assets.",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printInstallHelp);
}
