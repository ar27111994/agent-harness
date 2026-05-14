import { installBundles } from "./install/bundle.js";
import {
  diffInstallState,
  explainInstalledAsset,
  manageInstallGenerations,
} from "./install/generations.js";
import { manageNativeInstall } from "./install/native.js";
import { manageInstallRefresh } from "./install/refresh.js";
import { reconcileInstallState, resetInstallState } from "./install/state.js";
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
