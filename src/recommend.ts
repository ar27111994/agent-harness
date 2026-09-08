import { runRecommend as runRecommendCommand } from "./recommend/commands.js";

export * from "./recommend/commands.js";
export {
  buildRecommendationReport,
  writeRecommendationReport,
} from "./recommend/report.js";

/**
 * Thin recommendation facade that appends the cross-host compatibility
 * reference to parent help without coupling the large command dispatcher to
 * documentation-only copy.
 */
export async function runRecommend(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const exitCode = await runRecommendCommand(
    args,
    workingDirectory,
    projectRoot,
  );
  const [command] = args;
  if (
    command === "help" &&
    !args.some((arg) => arg !== "help" && arg.startsWith("-"))
  ) {
    console.log(
      "Cross-host compatibility: docs/reference/SHARED-HOST-COMPATIBILITY.md (the 'shared' catalog tag is not a wire/workspace adapter).",
    );
  }
  return exitCode;
}
