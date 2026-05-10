import { installBundles } from "./install/bundle.js";
import {
  diffInstallState,
  explainInstalledAsset,
  manageInstallGenerations,
} from "./install/generations.js";
import { manageNativeInstall } from "./install/native.js";
import { manageInstallRefresh } from "./install/refresh.js";
import { reconcileInstallState, resetInstallState } from "./install/state.js";

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
  console.log(`install commands:
  bundle      Stage installed assets from mirror bundle locks
  native      Plan/verify/apply/remove host-native installs
  refresh     Refresh mirrored install state and report/apply stale assets
  reconcile   Recompute install progress from bundle install manifests
  diff        Compare current vs previous or explicit install generations
  explain     Explain where an installed asset is present and active
  generations Manage generation list, pinning, and pruning
  reset       Remove install state, packages, bundles, and generations

Native install options:
  --host <vscode|opencode|cursor|zed|claude-code|pi>
  --operation <plan|install|verify|remove>
  --apply     Required for mutating install/remove operations

Install refresh options:
  --host <copilot-vscode|opencode|shared>
  --apply     Apply eligible stale bundle refreshes after reporting
  --due-only  Skip the run unless the persisted refresh interval says a check is due
  --no-mirror-refresh   Skip the explicit mirror refresh step and report from current local state only`);
}
