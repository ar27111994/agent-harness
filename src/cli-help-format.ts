import { printCommandHelp } from "./lib/cli-output.js";

/**
 * Shared subcommand help record type — a heading + usage/options lines.
 * Used by printSubcommandHelp to format domain-specific --help output.
 */
export interface SubcommandHelpEntry {
  heading: string;
  lines: string[];
}

/**
 * Returns true when --help or -h appears in the remaining args after the
 * subcommand has been parsed off. Use this at the top of every runXxx()
 * function to short-circuit into subcommand-specific help before any state
 * mutation occurs (#383).
 */
export function hasHelpFlag(rest: string[]): boolean {
  return rest.includes("--help") || rest.includes("-h");
}

/**
 * Formats and prints subcommand-specific help.
 *
 * Looks up `subcommand` in `helpTexts`. When found, prints a heading +
 * usage/options block via printCommandHelp. When not found, calls
 * `fallback()` (typically the domain's parent help printer).
 *
 * This replaces the ~40–160 line copy-pasted printXxxSubcommandHelp
 * functions that were duplicated across 7 command modules.
 *
 * @param write - Optional output writer for testing. Defaults to
 *   process.stdout.write.
 */
export function printSubcommandHelp(
  subcommand: string,
  helpTexts: Record<string, SubcommandHelpEntry>,
  fallback: () => void,
  write?: (chunk: string) => void,
): void {
  const originalWrite = process.stdout.write;
  if (write) {
    // Override stdout.write so printCommandHelp's output is captured.
    // Restored in the finally block.
    process.stdout.write = ((chunk: unknown): boolean => {
      write(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  }
  try {
    // Use Object.hasOwn to avoid prototype-pollution via __proto__ /
    // constructor / toString lookups on plain-object helpTexts records.
    if (Object.hasOwn(helpTexts, subcommand)) {
      const help = helpTexts[subcommand];
      printCommandHelp({
        heading: help.heading,
        entries: [],
        sections: [{ title: "", lines: help.lines }],
      });
    } else {
      fallback();
    }
  } finally {
    if (write) {
      process.stdout.write = originalWrite;
    }
  }
}
