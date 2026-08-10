import type { SubcommandFlagSpec } from "./cli-help-format.js";

/**
 * Re-exports the flag-spec type so table consumers (dispatchers and the
 * docs cross-check) import the shape from the single source of truth.
 */
export type { SubcommandFlagSpec } from "./cli-help-format.js";

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
    "bundle-explain": {
      knownFlags: new Set(["--bundle", "--json"]),
      flagsWithValues: new Set(["--bundle"]),
      usageHint: "agent-harness bundle explain --help",
    },
    "explain-bundle": {
      knownFlags: new Set(["--bundle", "--json"]),
      flagsWithValues: new Set(["--bundle"]),
      usageHint: "agent-harness bundle explain --help",
    },
    explain: {
      knownFlags: new Set(["--asset", "--mirror"]),
      flagsWithValues: new Set(["--asset", "--mirror"]),
      usageHint: "agent-harness mirror explain --help",
    },
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
