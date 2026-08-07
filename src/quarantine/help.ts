/**
 * quarantine/help — quarantine command-group help text (#435).
 *
 * Extracted from quarantine.ts following the activate/help.ts pattern: help
 * text lives apart from the quarantine state flows (list, inspect, review
 * decisions, report), keeping the core quarantine dispatcher under the
 * ~600-line decomposition budget.
 */

import {
  printSubcommandHelp,
  type SubcommandHelpEntry,
} from "../cli-help-format.js";
import { printCommandHelp } from "../lib/cli-output.js";

/**
 * Prints help for a specific quarantine subcommand (#383).
 */
export function printQuarantineSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    list: {
      heading: "quarantine list — List quarantined mirror artifacts",
      lines: [
        "Usage: agent-harness quarantine list",
        "",
        "Lists all mirror artifacts currently in quarantine, showing their",
        "quarantine reason, risk assessment, and current review status.",
      ],
    },
    inspect: {
      heading: "quarantine inspect — Inspect a quarantined artifact",
      lines: [
        "Usage: agent-harness quarantine inspect --asset <assetId>",
        "",
        "Prints detailed quarantine information for a specific artifact,",
        "including the full risk profile and review history.",
      ],
    },
    report: {
      heading: "quarantine report — Write quarantine state report",
      lines: [
        "Usage: agent-harness quarantine report",
        "",
        "Writes a full quarantine state report summarizing all quarantined",
        "artifacts, their review statuses, and aggregate statistics.",
        "",
        "Output: state/quarantine/report.json",
      ],
    },
    approve: {
      heading: "quarantine approve — Approve a quarantined artifact",
      lines: [
        "Usage: agent-harness quarantine approve --asset <assetId> [--reason <reason>] [--reviewer <name>]",
        "",
        "Approves a quarantined artifact, releasing it from quarantine",
        "and making it eligible for mirror acquisition.",
        "",
        "Options:",
        "  --reason <reason>   Review reason or justification",
        "  --reviewer <name>    Reviewer name or bot identifier",
      ],
    },
    reject: {
      heading: "quarantine reject — Reject a quarantined artifact",
      lines: [
        "Usage: agent-harness quarantine reject --asset <assetId> [--reason <reason>] [--reviewer <name>]",
        "",
        "Permanently rejects a quarantined artifact, blocking it from",
        "future mirror acquisition.",
        "",
        "Options:",
        "  --reason <reason>   Review reason or justification",
        "  --reviewer <name>    Reviewer name or bot identifier",
      ],
    },
    pin: {
      heading: "quarantine pin — Pin a quarantine review decision",
      lines: [
        "Usage: agent-harness quarantine pin --asset <assetId> [--reason <reason>] [--reviewer <name>]",
        "",
        "Pins the current review decision for a quarantined artifact,",
        "preserving it across future catalog updates.",
        "",
        "Options:",
        "  --reason <reason>   Review reason or justification",
        "  --reviewer <name>    Reviewer name or bot identifier",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printQuarantineHelp);
}

/**
 * Prints the quarantine command-group parent help.
 */
export function printQuarantineHelp(): void {
  printCommandHelp({
    heading: "quarantine commands:",
    entries: [
      {
        command: "list",
        description: "List quarantined mirror artifacts",
      },
      {
        command: "inspect --asset <assetId>",
        description: "Show quarantined artifact metadata and content preview",
      },
      {
        command: "report",
        description: "Write state/quarantine/quarantine-state.json",
      },
      {
        command: "approve --asset <assetId>",
        description: "Mark a quarantined artifact approved-with-warning",
      },
      {
        command: "reject --asset <assetId>",
        description:
          "Record a rejection decision while keeping quarantine status",
      },
      {
        command: "pin --asset <assetId>",
        description: "Pin a quarantine decision for future refresh reviews",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--asset <assetId>",
          "--mirror <mirrorId>",
          "--reason <review reason>",
          "--reviewer <name or bot id>",
        ],
      },
    ],
  });
}
