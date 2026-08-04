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
 * Returns true for tokens that look like options (`--flag`, `-f`) while
 * allowing the bare `-` (conventionally stdin) to pass as positional.
 */
export function isFlagLike(argument: string): boolean {
  return (
    argument.startsWith("--") || (argument.startsWith("-") && argument !== "-")
  );
}

/**
 * Prints a conventional unknown-argument error to stderr, followed by a
 * usage pointer — instead of dumping the full help text (#431).
 *
 * Exit handling is left to the caller, which must return a non-zero code.
 */
export function printUnknownArgumentError(
  argument: string,
  usageHint = "agent-harness <command> --help",
): void {
  const kind = isFlagLike(argument) ? "option" : "command";
  console.error(`error: unknown ${kind} '${argument}'`);
  console.error(`Run '${usageHint}' for usage.`);
}

/**
 * Returns the first `--flag` in `args` that is not in `knownFlags`, or
 * undefined when every flag is known.
 *
 * `--flag=value` forms are compared by their long name. Value-taking flags
 * listed in `flagsWithValues` have their following token skipped so values
 * that start with `--` (or are positioned after the flag) are not misread as
 * unknown flags.
 *
 * @param flagsWithValues  Long flag names that consume the next argument
 */
export function findUnknownFlag(
  args: readonly string[],
  knownFlags: ReadonlySet<string>,
  flagsWithValues: ReadonlySet<string> = new Set(),
): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--" || arg === "-") {
      // `--` ends option scanning; a bare `-` is conventionally stdin/stdout.
      break;
    }
    if (!arg.startsWith("-")) {
      continue;
    }
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!knownFlags.has(flagName)) {
      return flagName;
    }
    if (flagsWithValues.has(flagName) && !arg.includes("=")) {
      index += 1;
    }
  }
  return undefined;
}

/**
 * Reports and prints an unknown-option error when any flag in `args` is not
 * in `knownFlags` (#431). Returns true when an unknown flag was found, so
 * the caller can bail out with a non-zero exit before executing.
 */
export function rejectUnknownFlags(
  args: readonly string[],
  knownFlags: ReadonlySet<string>,
  flagsWithValues: ReadonlySet<string> = new Set(),
  usageHint = "agent-harness <command> --help",
): boolean {
  const unknown = findUnknownFlag(args, knownFlags, flagsWithValues);
  if (unknown === undefined) {
    return false;
  }
  printUnknownArgumentError(unknown, usageHint);
  return true;
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
