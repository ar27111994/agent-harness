import { acquireMirrorArtifacts } from "./mirror/acquire.js";
import { generateBundleLocks } from "./mirror/bundles.js";
import {
  diffMirrorIndex,
  explainBundleLock,
  explainMirrorArtifact,
} from "./mirror/inspect.js";
import { generateMirrorPlan } from "./mirror/plan.js";
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
 * Dispatches the mirror CLI command group.
 */
export async function runMirror(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

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
      printMirrorHelp();
      return 1;
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
