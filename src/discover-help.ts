/**
 * discover-help — pure help-text data for the discover command group (#434).
 *
 * Extracted from discover.ts so the dispatcher stays under the module-size
 * threshold and the ~380 lines of help copy live in one data-only module.
 */

import {
  printSubcommandHelp,
  type SubcommandHelpEntry,
} from "./cli-help-format.js";
import { printCommandHelp } from "./lib/cli-output.js";

/** Prints help for one discover subcommand. */
export function printDiscoverSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    sources: {
      heading: "discover sources — Refresh the discovery source index",
      lines: [
        "Usage: agent-harness discover sources",
        "",
        "Scans all configured asset-producing discovery sources (registries, repos,",
        "marketplaces, source packs) and writes a refreshed source-index to:",
        "  discover/output/source-index.json",
        "",
        "The source index is used by subsequent 'discover sync' and 'discover full'",
        "runs. Docs-kind metadata sources are intentionally excluded from enabled",
        "asset-source counts. Re-run after changing discover/sources.json or packs.",
        "",
        "Options:",
        "  --state-root <path>   Override state directory",
      ],
    },
    "demand-profile": {
      heading: "discover demand-profile — Scan workspace for demand signals",
      lines: [
        "Usage: agent-harness discover demand-profile",
        "",
        "Scans the current working directory for language, framework, package-manager,",
        "and concern signals. Writes the result to:",
        "  discover/output/demand-profile.json",
        "",
        "The demand profile drives catalog selection and recommendation scoring.",
      ],
    },
    catalog: {
      heading: "discover catalog — Build the discovery asset catalog",
      lines: [
        "Usage: agent-harness discover catalog",
        "",
        "Harvests configured asset-producing local and remote sources and writes the",
        "full asset catalog to:",
        "  discover/output/catalog.assets.jsonl",
        "",
        "'discover sync' is optional: run it first to refresh/persist indexed remote",
        "source data, or run catalog directly to use existing index state plus the",
        "live/rotating harvest paths available to each source.",
      ],
    },
    sync: {
      heading: "discover sync — Synchronize discovered sources",
      lines: [
        "Usage: agent-harness discover sync [--full]",
        "",
        "Fetches and persists data from configured indexed discovery sources. Uses the",
        "local index when fresh, performs live harvest otherwise.",
        "",
        "Options:",
        "  --full               Run full sync (otherwise uses cached index when fresh)",
        "  --state-root <path>   Override state directory",
      ],
    },
    index: {
      heading: "discover index — Build full offline catalog index",
      lines: [
        "Usage: agent-harness discover index",
        "",
        "Fully paginates all indexed sources to build a comprehensive offline catalog.",
        "This is slow but thorough — intended for scheduled CI runs, not interactive use.",
        "",
        "Env: AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD (default: 500, 0=unlimited)",
        "      AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS (default: 7)",
      ],
    },
    select: {
      heading: "discover select — Apply selection rules to the catalog",
      lines: [
        "Usage: agent-harness discover select [--ai-enrich] [--no-ai-enrich] [--require-ai-enrich] [--force]",
        "",
        "Applies canonical selection rules (demand relevance, deduplication, diversity",
        "caps) to the asset catalog and writes selected/rejected outputs to:",
        "  discover/output/catalog.selected.jsonl",
        "  discover/output/catalog.rejected.jsonl",
        "",
        "Prerequisite: 'discover catalog' must have been run first.",
        "",
        "AI enrichment options:",
        "  --ai-enrich          Run AI enrichment after selection",
        "  --no-ai-enrich       Skip AI enrichment (respects runtime config default)",
        "  --require-ai-enrich  Fail if AI enrichment is unavailable or fails",
        "  --force              Re-run enrichment even if already cached",
      ],
    },
    stats: {
      heading: "discover stats — Print catalog statistics",
      lines: [
        "Usage: agent-harness discover stats",
        "",
        "Prints summary counts from the selected catalog grouped by source, asset kind,",
        "host target, and authority tier.",
      ],
    },
    enrich: {
      heading: "discover enrich — Run AI-assisted enrichment on the catalog",
      lines: [
        "Usage: agent-harness discover enrich [--force] [--require-ai-enrich]",
        "",
        "Runs a bounded AI-assisted enrichment pass against the selected catalog to",
        "improve classification confidence, capability extraction, and deduplication.",
        "",
        "Options:",
        "  --force              Re-run enrichment even if already cached",
        "  --require-ai-enrich  Fail if AI enrichment is unavailable or fails",
        "",
        "Env: AGENT_HARNESS_AI_ENRICHMENT_URL",
        "      AGENT_HARNESS_AI_ENRICHMENT_API_KEY",
        "      AGENT_HARNESS_AI_ENRICHMENT_MODE (default: manual)",
        "      AGENT_HARNESS_AI_ENRICHMENT_MODEL (default: gpt-4o-mini)",
      ],
    },
    "ard-export": {
      heading: "discover ard-export — Export catalog to ARD format",
      lines: [
        "Usage: agent-harness discover ard-export [--quiet]",
        "",
        "Maps the selected catalog to the ARD 1.0 ai-catalog.json format and writes:",
        "  <state-root>/.well-known/ai-catalog.json",
        "",
        "ARD-compliant registries can then discover and index agent-harness as a",
        "publisher. Entries without a real update timestamp omit updatedAt",
        "instead of publishing the epoch sentinel (#449).",
        "",
        "Options:",
        "  --quiet  Suppress the completion line",
      ],
    },
    inspect: {
      heading: "discover inspect — Print catalog entries with optional filters",
      lines: [
        "Usage: agent-harness discover inspect [--source <sourceId>] [--id <assetId>] [--limit <n>]",
        "",
        "Prints catalog entries from the latest discovery run with optional",
        "source, asset ID, and count filters.",
        "",
        "Options:",
        "  --source <sourceId>  Filter to entries from this source",
        "  --id <assetId>       Show a specific asset entry",
        "  --limit <n>          Max entries to print (default: 20)",
      ],
    },
    diff: {
      heading: "discover diff — Compare discovery outputs against a baseline",
      lines: [
        "Usage: agent-harness discover diff --baseline <stateRoot>",
        "",
        "Compares current discovery outputs against a baseline state root.",
        "Use --json for machine-readable output.",
      ],
    },
    "environment-index": {
      heading: "discover environment-index — Write query metadata",
      lines: [
        "Usage: agent-harness discover environment-index [--json]",
        "",
        "Writes experimental read-only query metadata for the current workspace to:",
        "  discover/output/environment-index.json",
        "",
        "Options:",
        "  --json  Also print the index as JSON to stdout",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, () => {
    if (subcommand === "full") {
      printDiscoverFullHelp();
    } else if (
      subcommand === "breadth" ||
      subcommand === "recall" ||
      subcommand === "candidate-pool"
    ) {
      printDiscoverBreadthHelp();
    } else {
      printDiscoverHelp();
    }
  });
}

/** Prints the top-level discover command help. */
export function printDiscoverHelp(): void {
  printCommandHelp({
    heading: "discover commands:",
    entries: [
      {
        command: "demand-profile",
        description:
          "Scan the working directory and write discover/output/demand-profile.json",
      },
      {
        command: "sources",
        description:
          "Summarize enabled asset-producing sources into discover/output/source-index.json",
      },
      {
        command: "sync",
        description:
          "Optionally refresh/persist indexed discovery results — uses local index when fresh, live harvest otherwise",
      },
      {
        command: "index",
        description:
          "Build a full offline catalog index by fully paginating all indexed sources (slow, scheduled — run once or in CI)",
      },
      {
        command: "catalog",
        description:
          "Build discover/output/catalog.assets.jsonl; prior sync is optional",
      },
      {
        command: "select",
        description:
          "Apply canonical selection rules and write selected/rejected JSONL outputs",
      },
      {
        command: "full",
        description:
          "Run demand-profile, sources, sync, catalog, and select in one pass",
      },
      {
        command: "breadth",
        description:
          "Run the widest practical discovery pass and print candidate-pool guidance",
      },
      { command: "recall", description: "Alias for discover breadth" },
      { command: "candidate-pool", description: "Alias for discover breadth" },
      {
        command: "stats",
        description:
          "Print catalog summary counts grouped by source, kind, host, and authority",
      },
      {
        command: "diff",
        description:
          "Compare discovery outputs against --baseline <stateRoot> (--json for agents)",
      },
      {
        command: "environment-index",
        description:
          "Write experimental read-only query metadata to discover/output/environment-index.json",
      },
      {
        command: "ard-export",
        description:
          "Export selected catalog to ARD ai-catalog.json format at .well-known/ai-catalog.json",
      },
      {
        command: "enrich",
        description:
          "Run bounded AI-assisted enrichment against the selected catalog",
      },
      {
        command: "inspect",
        description:
          "Print catalog entries filtered by --source <id> or --id <assetId>",
      },
    ],
    sections: [
      {
        title: "Pipeline order:",
        lines: [
          "demand-profile -> sources -> sync (optional refresh) -> catalog -> select -> recommend report",
          "Use 'discover full' for the discover portion; mutable outputs live under <state-root>/discover/output.",
        ],
      },
      {
        title: "AI enrichment options:",
        lines: [
          "--ai-enrich         Explicitly request enrichment after select/full",
          "--no-ai-enrich      Explicitly skip enrichment for this select/full run",
          "--force             Bypass cache reuse and automatic policy skips, forcing a new provider call when enrichment runs",
          "--require-ai-enrich Fail the command when enrichment does not complete or reuse successfully",
        ],
      },
    ],
  });
}

/** Prints help for the complete discover pipeline. */
export function printDiscoverFullHelp(): void {
  printCommandHelp({
    heading: "discover full — Run the complete discovery pipeline in one pass",
    entries: [
      {
        command: "Usage:",
        description:
          "  agent-harness discover full [--no-sync] [--sync-all] [--ai-enrich] [--no-ai-enrich] [--quiet] [--summary] [--max-scan-bytes N]",
      },
      { command: "Steps executed in order:", description: "" },
      {
        command: "  1. demand-profile",
        description: "Scan the working directory for demand signals",
      },
      { command: "  2. sources", description: "Refresh the source index" },
      {
        command: "  3. sync",
        description: "Sync indexed sources to local state",
      },
      {
        command: "  4. catalog",
        description: "Build the unified asset catalog",
      },
      {
        command: "  5. select",
        description: "Apply canonical selection rules",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--ai-enrich         Run AI enrichment after selection",
          "--no-ai-enrich      Skip AI enrichment",
          "--no-sync           Skip indexed source sync (use existing state/live harvest paths)",
          "--sync-all          Sync all enabled sources (skip demand-based filtering)",
          "--quiet             Suppress expected source health warnings",
          "--summary           Print aggregate warning breakdown by reason",
          "--max-scan-bytes N   Override the demand scan byte budget (default: 48 MB)",
        ],
      },
      {
        title: "Outputs:",
        lines: [
          "discover/output/demand-profile.json",
          "discover/output/source-index.json",
          "discover/output/catalog.assets.jsonl",
          "discover/output/catalog.selected.jsonl",
          "discover/output/catalog.rejected.jsonl",
          "discover/output/selection-report.json",
        ],
      },
    ],
  });
}

/** Prints help for the broad discovery sweep and its aliases. */
export function printDiscoverBreadthHelp(): void {
  printCommandHelp({
    heading:
      "discover breadth — Run the widest practical discovery pass (aliases: recall, candidate-pool)",
    entries: [
      { command: "Description:", description: "" },
      {
        command:
          "  Runs demand-profile followed by a maximally broad discovery",
        description: "",
      },
      {
        command:
          "  pass that prioritizes candidate-pool coverage over precision.",
        description: "",
      },
      {
        command:
          "  Useful for surveying available assets before narrowing down.",
        description: "",
      },
      {
        command:
          "  REPLACES the discovery outputs: recommendations, mirror locks,",
        description: "",
      },
      {
        command:
          "  install generations, and activation manifests built from the",
        description: "",
      },
      {
        command: "  previous catalog are invalidated (a warning lists them).",
        description: "",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--state-root <path>  Write state under this path",
          "--ai-enrich          Run AI enrichment after breadth scan",
        ],
      },
      {
        title: "Aliases:",
        lines: [
          "discover recall           Same as discover breadth",
          "discover candidate-pool   Same as discover breadth",
        ],
      },
    ],
  });
}
