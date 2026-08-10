/**
 * Shared Windows shell-wrapper helpers for host-native command execution.
 *
 * Host CLIs frequently ship .cmd/.bat wrappers (VS Code's `code.cmd`, Cursor's
 * `cursor.cmd`), which Windows cannot launch directly — a shell must run them.
 * `child_process` `shell: true` concatenates arguments unescaped (Node DEP0190)
 * and cmd.exe re-parses the raw command line, so quoting cannot make hostile
 * arguments safe. Every command surface in this repo therefore shares the same
 * two-layer contract:
 *
 * 1. Fail closed: arguments containing cmd.exe metacharacters are refused
 *    before any shell sees them (see `containsShellMetaCharacters`).
 * 2. Execute wrappers through PowerShell with every token single-quoted as a
 *    literal (`buildWindowsPowerShellCommand`), preserving argv boundaries
 *    while never enabling shell interpretation.
 */

/**
 * Defines characters that cmd.exe (the target of .cmd/.bat wrappers)
 * interprets even inside quoted arguments: operators, redirection, batch
 * variable expansion, delayed expansion, and quote characters. Arguments
 * containing any of these must never cross into a wrapper invocation —
 * Windows batch-file argument parsing cannot be made safe for them by
 * quoting alone (cmd.exe re-parses the raw command line). The NUL byte is
 * checked separately to keep control characters out of the regex literal.
 */
const CMD_SHELL_META_PATTERN = /[&|<>^%!"\r\n]/u;

/**
 * Returns true when a value contains characters that cmd.exe interprets in
 * wrapper command lines regardless of quoting.
 */
export function containsShellMetaCharacters(value: string): boolean {
  return value.includes("\u0000") || CMD_SHELL_META_PATTERN.test(value);
}

/**
 * Returns whether an executable path is a Windows shell wrapper (.cmd /
 * .bat) that must be invoked through a shell.
 */
export function isWindowsShellWrapperPath(
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/iu.test(executablePath);
}

/**
 * Builds the PowerShell invocation that runs a Windows .cmd/.bat wrapper with
 * every token preserved as a literal. `&` is the call operator; each
 * executable/argument is wrapped in single quotes with embedded quotes
 * doubled, so spaces, apostrophes, operators, and redirection characters in
 * arguments are data, never syntax.
 */
export function buildWindowsPowerShellCommand(
  executable: string,
  args: string[],
): string {
  const quotedExecutable = quotePowerShellLiteral(executable);
  const quotedArgs = args.map((argument) => quotePowerShellLiteral(argument));
  return [`& ${quotedExecutable}`, ...quotedArgs].join(" ");
}

/**
 * Wraps a value in a PowerShell single-quoted literal, doubling embedded
 * single quotes so the literal cannot terminate early.
 */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}
