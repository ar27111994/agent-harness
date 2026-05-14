/**
 * Describes a command row rendered in CLI help output.
 */
export interface CommandHelpEntry {
  command: string;
  description: string;
}

/**
 * Describes an additional section rendered after the command list.
 */
export interface CommandHelpSection {
  title: string;
  lines: readonly string[];
}

/**
 * Formats a command help block with aligned command descriptions.
 */
export function formatCommandHelp(options: {
  heading: string;
  entries: readonly CommandHelpEntry[];
  sections?: readonly CommandHelpSection[];
}): string {
  const commandWidth = Math.max(
    ...options.entries.map((entry) => entry.command.length),
  );
  const lines = [options.heading];

  for (const entry of options.entries) {
    lines.push(`  ${entry.command.padEnd(commandWidth)} ${entry.description}`);
  }

  for (const section of options.sections ?? []) {
    lines.push("", section.title);
    for (const line of section.lines) {
      lines.push(`  ${line}`);
    }
  }

  return lines.join("\n");
}

/**
 * Prints a formatted command help block.
 */
export function printCommandHelp(options: {
  heading: string;
  entries: readonly CommandHelpEntry[];
  sections?: readonly CommandHelpSection[];
}): void {
  process.stdout.write(`${formatCommandHelp(options)}\n`);
}
