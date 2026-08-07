/**
 * activate/help — activate command-group help text (#435).
 *
 * Extracted from activate.ts following the discover-help.ts pattern: help
 * text lives apart from the activation state flows (swap, diff, explain,
 * rollback, reset), keeping the core activation module under the ~600-line
 * decomposition budget.
 */

import {
  printSubcommandHelp,
  type SubcommandHelpEntry,
} from "../cli-help-format.js";
import { printCommandHelp } from "../lib/cli-output.js";
import { SESSION_INTENT_CHOICES } from "../lib/session-intent.js";

/**
 * Prints the activate command-group parent help.
 */
export function printActivateHelp(): void {
  printCommandHelp({
    heading: "activate commands:",
    entries: [
      {
        command: "host",
        description: "Materialize active host views from installed bundles",
      },
      {
        command: "diff",
        description:
          "Compare current host activation to the previous activation view",
      },
      {
        command: "explain",
        description: "Explain whether an asset is active for a host",
      },
      {
        command: "rollback",
        description: "Point a host to a previous install generation",
      },
      {
        command: "reset",
        description: "Remove activation outputs",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--host <copilot-vscode|opencode|shared>",
          "--recommendation-host <host-policy-id>",
          `--intent <${SESSION_INTENT_CHOICES}> Repeatable; first intent is used for activation context`,
        ],
      },
    ],
  });
}

/**
 * Prints help for a specific activate subcommand (#383).
 */
export function printActivateSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    host: {
      heading: "activate host — Materialize active host views",
      lines: [
        "Usage: agent-harness activate host [--host <host>] [--intent <intent>]",
        "",
        "Materializes active host views from installed bundles. Builds host-specific",
        "runtime views (MCP server configs, skill registries, instruction sets) from",
        "the installed asset bundles.",
        "",
        "Options:",
        "  --host <host>                           Target host",
        "  --intent <intent>                       Session intent (repeatable)",
        "  --recommendation-host <host-policy-id>   Override recommendation host policy",
        "",
        "Supported hosts: copilot-vscode, opencode, shared",
      ],
    },
    diff: {
      heading: "activate diff — Compare activation states",
      lines: [
        "Usage: agent-harness activate diff [--host <host>]",
        "",
        "Compares the current host activation view against the previous",
        "activation snapshot, reporting added, removed, and changed assets.",
      ],
    },
    explain: {
      heading: "activate explain — Explain activation state",
      lines: [
        "Usage: agent-harness activate explain --asset <assetId> [--host <host>]",
        "",
        "Explains whether a specific asset is active for a host and why.",
      ],
    },
    rollback: {
      heading: "activate rollback — Roll back to previous generation",
      lines: [
        "Usage: agent-harness activate rollback [--host <host>]",
        "",
        "Points a host back to a previous install generation, reverting",
        "the active asset set to an earlier known-good state.",
      ],
    },
    reset: {
      heading: "activate reset — Remove activation outputs",
      lines: [
        "Usage: agent-harness activate reset",
        "",
        "Removes all activation outputs, resetting the host runtime views",
        "to an empty state.",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printActivateHelp);
}
