import type { SubcommandFlagSpec } from "./cli-help-format.js";

/**
 * Re-exports the flag-spec type so table consumers (dispatchers and the
 * docs cross-check) import the shape from the single source of truth.
 */
export type { SubcommandFlagSpec } from "./cli-help-format.js";

/**
 * Builds the flag spec for the `help` subcommand: help takes no options,
 * so EVERY flag is rejected. Without an entry, the shared guard returns
 * false for a missing spec and `help --invalid` would silently print help
 * and exit 0, bypassing strict validation (review).
 */
function helpSubcommandSpec(domain: string): SubcommandFlagSpec {
  return {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: `agent-harness ${domain} help`,
  };
}

/**
 * Shared flag spec for `mirror bundle-explain` and its alias
 * `mirror explain-bundle` (review S2): both spellings dispatch to the same
 * command, so one spec object serves both table keys — a flag added to one
 * can never drift out of the other.
 */
const BUNDLE_EXPLAIN_SPEC: SubcommandFlagSpec = {
  knownFlags: new Set(["--bundle", "--json"]),
  flagsWithValues: new Set(["--bundle"]),
  usageHint: "agent-harness bundle explain --help",
};

/**
 * Flag spec table for mirror subcommands (#445): the shared unknown-flag
 * guard rejects typo'd flags before any mirror work or state write.
 */
export const MIRROR_SUBCOMMAND_FLAG_SPECS: Record<string, SubcommandFlagSpec> =
  {
    plan: {
      knownFlags: new Set(),
      flagsWithValues: new Set(),
      usageHint: "agent-harness mirror plan --help",
    },
    locks: {
      knownFlags: new Set(),
      flagsWithValues: new Set(),
      usageHint: "agent-harness mirror locks --help",
    },
    acquire: {
      knownFlags: new Set(["--batch-size"]),
      flagsWithValues: new Set(["--batch-size"]),
      usageHint: "agent-harness mirror acquire --help",
    },
    diff: {
      knownFlags: new Set(),
      flagsWithValues: new Set(),
      usageHint: "agent-harness mirror diff --help",
    },
    "bundle-explain": BUNDLE_EXPLAIN_SPEC,
    "explain-bundle": BUNDLE_EXPLAIN_SPEC,
    explain: {
      knownFlags: new Set(["--asset", "--mirror"]),
      flagsWithValues: new Set(["--asset", "--mirror"]),
      usageHint: "agent-harness mirror explain --help",
    },
    help: helpSubcommandSpec("mirror"),
  };

/**
 * Flag spec table for discover subcommands (review S3): replaces the
 * ad-hoc per-case `hasUnknownFlag(rest, new Set([...]), ...)` blocks with
 * the same shared table + guard primitive the other command domains use,
 * so discover flag handling can never diverge from the pattern enforced
 * everywhere else. Subcommands without options (breadth/recall/
 * candidate-pool/stats/ard-export body flags) declare empty sets, so ANY
 * flag is rejected exactly as before. demand-profile/sources/catalog/index
 * are intentionally absent: they historically accepted options without
 * validation and the sweep contract only covers the guarded set.
 */
export const DISCOVER_SUBCOMMAND_FLAG_SPECS: Record<
  string,
  SubcommandFlagSpec
> = {
  sync: {
    knownFlags: new Set(["--full"]),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover sync --help",
  },
  select: {
    knownFlags: new Set([
      "--ai-enrich",
      "--no-ai-enrich",
      "--force",
      "--require-ai-enrich",
    ]),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover select --help",
  },
  full: {
    knownFlags: new Set([
      "--ai-enrich",
      "--no-ai-enrich",
      "--force",
      "--require-ai-enrich",
      "--quiet",
      "--summary",
      "--no-sync",
      "--sync-all",
      "--max-scan-bytes",
    ]),
    flagsWithValues: new Set(["--max-scan-bytes"]),
    usageHint: "agent-harness discover full --help",
  },
  breadth: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover breadth --help",
  },
  recall: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover recall --help",
  },
  "candidate-pool": {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover candidate-pool --help",
  },
  enrich: {
    knownFlags: new Set(["--force", "--require-ai-enrich"]),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover enrich --help",
  },
  stats: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover stats --help",
  },
  diff: {
    knownFlags: new Set(["--baseline", "--json"]),
    flagsWithValues: new Set(["--baseline"]),
    usageHint: "agent-harness discover diff --help",
  },
  "environment-index": {
    knownFlags: new Set(["--json"]),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover environment-index --help",
  },
  "ard-export": {
    knownFlags: new Set(["--quiet"]),
    flagsWithValues: new Set(),
    usageHint: "agent-harness discover ard-export --help",
  },
  inspect: {
    knownFlags: new Set(["--source", "--id", "--limit"]),
    flagsWithValues: new Set(["--source", "--id", "--limit"]),
    usageHint: "agent-harness discover inspect --help",
  },
  help: helpSubcommandSpec("discover"),
};

/**
 * Flag spec table for install/stage subcommands (#445): the shared
 * unknown-flag guard rejects typo'd flags before any install work or state
 * write. Mirrors the documented flag surface in printInstallSubcommandHelp.
 */
export const INSTALL_SUBCOMMAND_FLAG_SPECS: Record<string, SubcommandFlagSpec> =
  {
    bundle: {
      knownFlags: new Set([
        "--bundle",
        "--batch-size",
        "--offset",
        "--asset",
        "--host",
      ]),
      flagsWithValues: new Set([
        "--bundle",
        "--batch-size",
        "--offset",
        "--asset",
        "--host",
      ]),
      usageHint: "agent-harness install bundle --help",
    },
    native: {
      knownFlags: new Set(["--host", "--operation", "--apply"]),
      flagsWithValues: new Set(["--host", "--operation"]),
      usageHint: "agent-harness install native --help",
    },
    refresh: {
      knownFlags: new Set([
        "--host",
        "--apply",
        "--due-only",
        "--no-mirror-refresh",
      ]),
      flagsWithValues: new Set(["--host"]),
      usageHint: "agent-harness install refresh --help",
    },
    reconcile: {
      knownFlags: new Set(["--host"]),
      flagsWithValues: new Set(["--host"]),
      usageHint: "agent-harness install reconcile --help",
    },
    diff: {
      knownFlags: new Set(["--host", "--left", "--right"]),
      flagsWithValues: new Set(["--host", "--left", "--right"]),
      usageHint: "agent-harness install diff --help",
    },
    explain: {
      knownFlags: new Set(["--asset"]),
      flagsWithValues: new Set(["--asset"]),
      usageHint: "agent-harness install explain --help",
    },
    generations: {
      knownFlags: new Set(["--host", "--generation", "--reason", "--keep"]),
      flagsWithValues: new Set([
        "--host",
        "--generation",
        "--reason",
        "--keep",
      ]),
      usageHint: "agent-harness install generations --help",
    },
    reset: {
      knownFlags: new Set(["--host"]),
      flagsWithValues: new Set(["--host"]),
      usageHint: "agent-harness install reset --help",
    },
    help: helpSubcommandSpec("install"),
  };

/**
 * Flag spec table for activate subcommands (#445): the shared unknown-flag
 * guard rejects typo'd flags (e.g. --rec-host) before activation work or
 * state writes.
 */
export const ACTIVATE_SUBCOMMAND_FLAG_SPECS: Record<
  string,
  SubcommandFlagSpec
> = {
  host: {
    knownFlags: new Set(["--host", "--recommendation-host", "--intent"]),
    flagsWithValues: new Set(["--host", "--recommendation-host", "--intent"]),
    usageHint: "agent-harness activate host --help",
  },
  diff: {
    knownFlags: new Set(["--host"]),
    flagsWithValues: new Set(["--host"]),
    usageHint: "agent-harness activate diff --help",
  },
  explain: {
    knownFlags: new Set(["--host", "--asset"]),
    flagsWithValues: new Set(["--host", "--asset"]),
    usageHint: "agent-harness activate explain --help",
  },
  rollback: {
    knownFlags: new Set(["--host", "--generation"]),
    flagsWithValues: new Set(["--host", "--generation"]),
    usageHint: "agent-harness activate rollback --help",
  },
  reset: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness activate reset --help",
  },
  help: helpSubcommandSpec("activate"),
};

/**
 * Flag spec table for quarantine subcommands (#445): the shared unknown-flag
 * guard rejects typo'd flags before any review decision or state write.
 */
export const QUARANTINE_SUBCOMMAND_FLAG_SPECS: Record<
  string,
  SubcommandFlagSpec
> = {
  list: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness quarantine list --help",
  },
  inspect: {
    knownFlags: new Set(["--asset", "--mirror"]),
    flagsWithValues: new Set(["--asset", "--mirror"]),
    usageHint: "agent-harness quarantine inspect --help",
  },
  report: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness quarantine report --help",
  },
  approve: {
    knownFlags: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    flagsWithValues: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    usageHint: "agent-harness quarantine approve --help",
  },
  reject: {
    knownFlags: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    flagsWithValues: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    usageHint: "agent-harness quarantine reject --help",
  },
  pin: {
    knownFlags: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    flagsWithValues: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    usageHint: "agent-harness quarantine pin --help",
  },
  help: helpSubcommandSpec("quarantine"),
};

/**
 * Flag spec table for rebuild subcommands (#445): clean/full take no
 * options, so every flag is rejected before any state is removed.
 */
export const REBUILD_SUBCOMMAND_FLAG_SPECS: Record<string, SubcommandFlagSpec> =
  {
    clean: {
      knownFlags: new Set(),
      flagsWithValues: new Set(),
      usageHint: "agent-harness rebuild clean --help",
    },
    full: {
      knownFlags: new Set(),
      flagsWithValues: new Set(),
      usageHint: "agent-harness rebuild full --help",
    },
    help: helpSubcommandSpec("rebuild"),
  };

/**
 * Flag spec table for recommend subcommands (#445): the shared unknown-flag
 * guard rejects typo'd flags before any recommendation work or report write.
 */
export const RECOMMEND_SUBCOMMAND_FLAG_SPECS: Record<
  string,
  SubcommandFlagSpec
> = {
  report: {
    knownFlags: new Set([
      "--ai-review",
      "--intent",
      "--host",
      "--review-limit",
    ]),
    flagsWithValues: new Set(["--intent", "--host", "--review-limit"]),
    usageHint: "agent-harness recommend report --help",
  },
  explain: {
    knownFlags: new Set(["--asset", "--host", "--json"]),
    flagsWithValues: new Set(["--asset", "--host"]),
    usageHint: "agent-harness recommend explain --help",
  },
  evaluate: {
    knownFlags: new Set(["--write"]),
    flagsWithValues: new Set(),
    usageHint: "agent-harness recommend evaluate --help",
  },
  "ai-review": {
    knownFlags: new Set(["--host", "--review-limit", "--apply", "--intent"]),
    flagsWithValues: new Set(["--host", "--review-limit", "--intent"]),
    usageHint: "agent-harness recommend ai-review --help",
  },
  "policy:print": {
    knownFlags: new Set(["--host", "--compact"]),
    flagsWithValues: new Set(["--host"]),
    usageHint: "agent-harness recommend policy:print --help",
  },
  help: helpSubcommandSpec("recommend"),
};

/**
 * Maps every flag-spec domain to its subcommand flag table — the single
 * source of truth both for the CLI unknown-flag guards (#445) and for the
 * doc/examples cross-check that asserts documented commands parse cleanly
 * (#450). Domains with per-dispatcher inline guards (discover/wire/workspace)
 * are not listed here; setup was migrated to the shared table guard in the
 * #445/#446 wave.
 */
export const DOMAIN_SUBCOMMAND_FLAG_SPECS: Record<
  string,
  Readonly<Record<string, SubcommandFlagSpec>>
> = {
  mirror: MIRROR_SUBCOMMAND_FLAG_SPECS,
  bundle: MIRROR_SUBCOMMAND_FLAG_SPECS,
  install: INSTALL_SUBCOMMAND_FLAG_SPECS,
  stage: INSTALL_SUBCOMMAND_FLAG_SPECS,
  activate: ACTIVATE_SUBCOMMAND_FLAG_SPECS,
  quarantine: QUARANTINE_SUBCOMMAND_FLAG_SPECS,
  rebuild: REBUILD_SUBCOMMAND_FLAG_SPECS,
  recommend: RECOMMEND_SUBCOMMAND_FLAG_SPECS,
};
