import { installBundles } from "./install/bundle.js";
import {
  diffInstallState,
  explainInstalledAsset,
  manageInstallGenerations,
} from "./install/generations.js";
import { manageNativeInstall } from "./install/native.js";
import { reconcileInstallState, resetInstallState } from "./install/state.js";

export async function runInstall(
  args: string[],
  _workingDirectory: string,
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
  reconcile   Recompute install progress from bundle install manifests
  diff        Compare current vs previous or explicit install generations
  explain     Explain where an installed asset is present and active
  generations Manage generation list, pinning, and pruning
  reset       Remove install state, packages, bundles, and generations

Native install options:
  --host <vscode|opencode|cursor|zed|claude-code|pi>
  --operation <plan|install|verify|remove>
  --apply     Required for mutating install/remove operations`);
}
