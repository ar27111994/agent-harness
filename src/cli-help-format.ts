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
 * Describes the flags a subcommand accepts for the shared unknown-flag
 * guard (#445). One entry per subcommand; subcommands that take no options
 * use empty sets so every flag is rejected.
 */
export interface SubcommandFlagSpec {
  knownFlags: ReadonlySet<string>;
  flagsWithValues: ReadonlySet<string>;
  usageHint: string;
}

/**
 * Rejects flags that a subcommand does not declare in its flag spec table,
 * printing an unknown-option error with a usage pointer (#431, #445).
 *
 * Returns true (and prints) when an undeclared flag is present; the caller
 * must bail out with a non-zero exit before executing. Subcommands without a
 * spec entry (unknown subcommands) are never misread as flag rejections —
 * the caller's unknown-command handling owns those.
 */
export function hasUnknownFlagsForSubcommands(
  specs: Readonly<Record<string, SubcommandFlagSpec>>,
  subcommand: string,
  rest: readonly string[],
): boolean {
  // Own-property lookup only: `specs["constructor"]` / `specs["toString"]`
  // would resolve inherited Object.prototype members to functions, which
  // are not SubcommandFlagSpec and would crash hasUnknownFlag instead of
  // letting the caller's unknown-command handling own them.
  if (!Object.prototype.hasOwnProperty.call(specs, subcommand)) {
    return false;
  }
  const spec = specs[subcommand];
  return hasUnknownFlag(
    rest,
    spec.knownFlags,
    spec.flagsWithValues,
    spec.usageHint,
  );
}

/**
 * Marks an error caused by invalid user input (bad flag value, missing
 * required option, unknown provider, not-found lookup target) rather than
 * an internal defect (#446).
 *
 * The CLI entry point prints these as a one-line actionable message without
 * stack frames; any other error keeps its full stack so genuine bugs stay
 * debuggable. Argument-validation helpers across domains throw this type so
 * user mistakes never surface `at ... (file://...)` frames on stderr.
 */
export class CliUsageError extends Error {
  readonly usageHint?: string;

  constructor(message: string, usageHint?: string) {
    super(message);
    this.name = "CliUsageError";
    this.usageHint = usageHint;
  }
}

/**
 * Prints a user-input error as a one-line actionable message plus a usage
 * pointer, without internal stack frames (#446). The usage hint comes from
 * the error itself when the throwing site knows its subcommand; otherwise it
 * falls back to the caller-provided domain (or the generic top-level help).
 */
export function printCliUsageError(
  error: CliUsageError,
  fallbackHint = "agent-harness <command> --help",
): void {
  console.error(`error: ${error.message}`);
  const hint = error.usageHint ?? fallbackHint;
  console.error(`Run '${hint}' for usage.`);
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
    const arg = args[index];
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
export function hasUnknownFlag(
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
 * Handles an unrecognized subcommand token in a dispatcher `default` branch
 * and returns the exit code (always 1).
 *
 * Flag-like first tokens are unknown options: they are named on stderr with
 * a usage pointer instead of dumping parent help (#431). Non-flag unknown
 * subcommands still show the domain's parent help with a non-zero exit.
 * Collapses the repeated guard that previously appeared in every command
 * dispatcher.
 */
export function handleUnknownCommand(
  command: string,
  fallback: () => void,
): number {
  if (isFlagLike(command)) {
    printUnknownArgumentError(command);
    return 1;
  }

  fallback();
  return 1;
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
