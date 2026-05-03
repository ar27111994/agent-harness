import { acquireMirrorArtifacts } from "./mirror/acquire.js";
import { generateBundleLocks } from "./mirror/bundles.js";
import { diffMirrorIndex, explainMirrorArtifact } from "./mirror/inspect.js";
import { generateMirrorPlan } from "./mirror/plan.js";

export { resolveSafeMirrorFilePath } from "./lib/safe-paths.js";
export { resolveAllowedMirrorEvidenceFilePath } from "./mirror/paths.js";

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
  console.log(`mirror commands:
  plan    Summarize mirror readiness into mirror/audit/mirror-plan.json
  locks   Generate initial bundle lock files from selected catalog entries
  acquire Acquire raw mirror artifacts, write mirror index, and resolve bundle locks
  diff    Compare current mirror index to the previous mirror index snapshot
  explain Explain a mirrored artifact by --asset <assetId> or --mirror <mirrorId>`);
}
