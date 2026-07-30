#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { loadDotEnvFile } from "./config/env-file.js";
import { clearRuntimeConfig } from "./config/runtime.js";
import { runDiscover } from "./discover.js";
import { resolveProjectRoot } from "./files.js";
import { clearGitHubState } from "./github.js";
import { runInstall } from "./install.js";
import { printCommandHelp } from "./lib/cli-output.js";
import { runMirror } from "./mirror.js";
import { runRecommend } from "./recommend.js";
import { runQuarantine } from "./quarantine.js";
import { runActivate } from "./activate.js";
import { runRebuild } from "./rebuild.js";
import { runWorkspace } from "./workspace.js";
import { runSetup } from "./setup.js";
import { runWire } from "./wire.js";
import { prepareStateRoot, resolveStateRoot } from "./lib/state-root.js";

/** Returns the package version from the installed package.json. */
async function readPackageVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const pkgPath = join(
      resolveProjectRoot(fileURLToPath(import.meta.url)),
      "package.json",
    );
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP_DEFAULT_DOMAINS = new Set([
  "activate",
  "discover",
  "install",
  "stage",
  "mirror",
  "bundle",
  "quarantine",
  "rebuild",
  "wire",
  "workspace",
]);

async function main(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  const globalOptions = parseGlobalOptions(rawArgs);
  const [domain, ...args] = globalOptions.args;
  const workingDirectory = process.cwd();
  if (isHelpRequest(globalOptions.args)) {
    return runHelpCommand(globalOptions.args, workingDirectory);
  }

  if (isVersionRequest(globalOptions.args)) {
    const version = await readPackageVersion();
    console.log(version);
    return 0;
  }

  const packageRoot = resolveProjectRoot(fileURLToPath(import.meta.url));
  if (!globalOptions.noDotEnv) {
    await loadDotEnvFile(workingDirectory);
  }
  clearRuntimeConfig();
  clearGitHubState();
  const preparedStateRoot = resolveStateRoot({
    packageRoot,
    workingDirectory,
    explicitStateRoot: globalOptions.stateRoot,
  });
  await prepareStateRoot(preparedStateRoot);
  const projectRoot = preparedStateRoot.stateRoot;

  switch (domain) {
    case "discover":
      return runDiscover(args, workingDirectory, projectRoot);
    case "mirror":
      return runMirror(args, workingDirectory, projectRoot);
    case "bundle":
      if (args.length === 0) {
        return runMirror(["help"], workingDirectory, projectRoot);
      }
      if (args[0] !== "explain") {
        printHelp();
        return 1;
      }
      return runMirror(
        ["bundle-explain", ...args.slice(1)],
        workingDirectory,
        projectRoot,
      );
    case "install":
    case "stage":
      return runInstall(args, workingDirectory, projectRoot);
    case "activate":
      return runActivate(args, workingDirectory, projectRoot);
    case "recommend":
      return runRecommend(args, workingDirectory, projectRoot);
    case "quarantine":
      return runQuarantine(args, projectRoot);
    case "rebuild":
      return runRebuild(args, workingDirectory, projectRoot);
    case "workspace":
      return runWorkspace(args, workingDirectory, projectRoot);
    case "wire":
      return runWire(args, workingDirectory, projectRoot);
    case "setup":
    case "doctor":
      return runSetup(
        domain === "doctor" ? ["doctor", ...args] : args,
        projectRoot,
      );
    case undefined:
      printHelp();
      return 0;
    default:
      printHelp();
      return 1;
  }
}

interface GlobalCliOptions {
  args: string[];
  stateRoot?: string;
  noDotEnv: boolean;
}

function isHelpRequest(args: string[]): boolean {
  return (
    args.length === 0 ||
    args[0] === "help" ||
    args.includes("--help") ||
    args.includes("-h") ||
    (args.length === 1 && HELP_DEFAULT_DOMAINS.has(args[0] ?? ""))
  );
}

function isVersionRequest(args: string[]): boolean {
  return args.includes("--version") || args.includes("-V");
}

function runHelpCommand(
  args: string[],
  workingDirectory: string,
): Promise<number> {
  // Determine whether help was explicitly requested (--help / -h in original args).
  // We need this before filtering because the nonFlagArgs filter removes them.
  const wasHelpRequested =
    args.includes("--help") || args.includes("-h") || args[0] === "help";

  const nonFlagArgs = args.filter(
    (arg) => arg !== "--help" && arg !== "-h" && arg !== "help",
  );

  // When --help appears at subcommand depth (e.g., "discover full --help"),
  // route to the domain handler. Only discover and recommend handle --help
  // internally for subcommand-specific help output. For mutating domains
  // (mirror, install, activate, quarantine, rebuild, workspace, wire, setup),
  // we substitute "help" to prevent mutation — the handler then shows its
  // generic help without executing any phase.
  if (nonFlagArgs.length >= 2) {
    const [domain, subcommand, ...extra] = nonFlagArgs;
    // Mutating domains don't inspect argv for --help — substitute "help" so
    // they output help instead of executing the subcommand.
    const MUTATING_DOMAINS = new Set([
      "mirror",
      "install",
      "stage",
      "activate",
      "quarantine",
      "rebuild",
      "workspace",
      "wire",
      "setup",
      "doctor",
      "bundle",
    ]);
    const safeSubcommand = wasHelpRequested
      ? MUTATING_DOMAINS.has(domain)
        ? "help"
        : subcommand
      : subcommand;
    const domainArgs = [safeSubcommand, ...extra];
    if (wasHelpRequested && !MUTATING_DOMAINS.has(domain)) {
      // discover and recommend inspect --help in their args
      domainArgs.push("--help");
    }
    switch (domain) {
      case "discover":
        return runDiscover(domainArgs, workingDirectory, "");
      case "recommend":
        return runRecommend(domainArgs, workingDirectory, "");
      case "mirror":
      case "bundle":
        return runMirror(domainArgs, workingDirectory, "");
      case "install":
      case "stage":
        return runInstall(domainArgs, workingDirectory, "");
      case "activate":
        return runActivate(domainArgs, workingDirectory, "");
      case "quarantine":
        return runQuarantine(domainArgs, "");
      case "rebuild":
        return runRebuild(domainArgs, workingDirectory, "");
      case "workspace":
        return runWorkspace(domainArgs, workingDirectory, "");
      case "wire":
        return runWire(domainArgs, workingDirectory, "");
      case "setup":
      case "doctor":
        return runSetup(domainArgs, "");
      default:
        printHelp();
        return Promise.resolve(1);
    }
  }

  const domain = resolveHelpDomain(args);

  switch (domain) {
    case "discover":
      return runDiscover(["help"], workingDirectory, "");
    case "mirror":
      return runMirror(["help"], workingDirectory, "");
    case "bundle":
      return runMirror(["help"], workingDirectory, "");
    case "install":
    case "stage":
      return runInstall(["help"], workingDirectory, "");
    case "activate":
      return runActivate(["help"], workingDirectory, "");
    case "recommend":
      return runRecommend(["help"], workingDirectory, "");
    case "quarantine":
      return runQuarantine(["help"], "");
    case "rebuild":
      return runRebuild(["help"], workingDirectory, "");
    case "workspace":
      return runWorkspace(["help"], workingDirectory, "");
    case "wire":
      return runWire(["help"], workingDirectory, "");
    case "setup":
    case "doctor":
      return runSetup(["help"], "");
    case undefined:
    case "help":
      printHelp();
      return Promise.resolve(0);
    default:
      printHelp();
      return Promise.resolve(1);
  }
}

function resolveHelpDomain(args: string[]): string | undefined {
  const helpIndex = args.indexOf("help");
  if (helpIndex !== -1) {
    const domainAfterHelp = args[helpIndex + 1];
    return domainAfterHelp && !domainAfterHelp.startsWith("-")
      ? domainAfterHelp
      : undefined;
  }

  return args.find((arg) => arg !== "--help" && arg !== "-h");
}

function parseGlobalOptions(args: string[]): GlobalCliOptions {
  const nextArgs: string[] = [];
  let stateRoot: string | undefined;
  let noDotEnv = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--state-root") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--state-root requires a path value");
      }
      stateRoot = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--state-root=")) {
      const value = arg.slice("--state-root=".length);
      if (!value) {
        throw new Error("--state-root requires a path value");
      }
      stateRoot = value;
      continue;
    }

    if (arg === "--no-dotenv") {
      noDotEnv = true;
      continue;
    }

    nextArgs.push(arg);
  }

  return { args: nextArgs, stateRoot, noDotEnv };
}

function printHelp(): void {
  printCommandHelp({
    heading: "agent-harness commands:",
    entries: [
      {
        command: "discover demand-profile",
        description: "Scan the working directory and emit a demand profile",
      },
      {
        command: "discover sources",
        description: "Summarize enabled discovery sources",
      },
      {
        command: "discover sync",
        description:
          "Persist indexed discovery results for supported high-volume sources",
      },
      {
        command: "discover catalog",
        description: "Build the unified asset catalog",
      },
      {
        command: "discover select",
        description: "Apply canonical selection policies",
      },
      {
        command: "discover full",
        description:
          "Run demand-profile, sources, sync, catalog, and select in one pass",
      },
      {
        command: "discover breadth",
        description:
          "Run the widest practical discovery pass and print candidate-pool guidance",
      },
      {
        command: "discover stats",
        description: "Print catalog/source stats",
      },
      {
        command: "discover diff",
        description: "Compare discovery outputs against a baseline state root",
      },
      {
        command: "discover environment-index",
        description: "Write experimental read-only query metadata index",
      },
      {
        command: "discover ard-export",
        description: "Export selected catalog to ARD ai-catalog.json format",
      },
      {
        command: "mirror locks",
        description: "Generate mirror bundle locks",
      },
      {
        command: "mirror acquire",
        description: "Acquire raw mirror artifacts and resolve bundle locks",
      },
      {
        command: "bundle explain <bundleId>",
        description: "Explain why assets are present in a bundle lock",
      },
      {
        command: "mirror bundle-explain",
        description: "Alias for bundle explain",
      },
      {
        command: "stage bundle",
        description: "Stage mirrored assets from bundle locks",
      },
      {
        command: "stage native",
        description: "Plan/verify/apply/remove host-native installs",
      },
      {
        command: "stage refresh",
        description:
          "Refresh staged install state and report/apply stale assets",
      },
      {
        command: "stage reconcile",
        description: "Recompute staged install progress and generations",
      },
      {
        command: "stage diff",
        description:
          "Compare current vs previous or explicit staged generations",
      },
      {
        command: "stage explain",
        description: "Explain where a staged asset is present and active",
      },
      {
        command: "stage generations",
        description: "Manage staged generation list, pinning, and pruning",
      },
      {
        command: "stage reset",
        description: "Remove staged install state",
      },
      {
        command: "install <...>",
        description: "Alias for stage <...>",
      },
      {
        command: "activate host",
        description: "Materialize active host views from staged bundles",
      },
      {
        command: "activate rollback",
        description: "Point a host to a previous generation",
      },
      {
        command: "activate reset",
        description: "Remove activation state",
      },
      {
        command: "recommend report",
        description: "Recompute the recommendation report",
      },
      {
        command: "recommend ai-review",
        description: "Run bounded recommendation-native AI review",
      },
      {
        command: "recommend explain",
        description:
          "Explain why an asset was selected, rejected, quarantined, or budget-pruned",
      },
      {
        command: "recommend evaluate",
        description: "Run golden recommendation fixtures",
      },
      {
        command: "quarantine list",
        description:
          "List, inspect, approve, or reject quarantined mirror artifacts",
      },
      {
        command: "rebuild clean",
        description:
          "Remove install/activate transient state for a clean rebuild",
      },
      {
        command: "rebuild full",
        description:
          "Clean and regenerate discover/mirror/install/activate state",
      },
      {
        command: "workspace vscode",
        description: "Run the full pipeline for a VS Code / Copilot workspace",
      },
      {
        command: "workspace opencode",
        description: "Run the full pipeline for an OpenCode workspace",
      },
      {
        command: "workspace cursor",
        description:
          "Run the Copilot-compatible pipeline and wire Cursor project files",
      },
      {
        command: "workspace zed",
        description:
          "Run the OpenCode-compatible pipeline and wire Zed project files",
      },
      {
        command: "workspace claude-code",
        description:
          "Run the OpenCode-compatible pipeline and wire Claude Code project files",
      },
      {
        command: "workspace pi",
        description:
          "Run the OpenCode-compatible pipeline and wire Pi project files",
      },
      {
        command: "wire vscode",
        description: "Preview/apply/reset VS Code user-scoped wire-in",
      },
      {
        command: "wire opencode",
        description: "Preview/apply/reset OpenCode project-local wire-in",
      },
      {
        command: "wire cursor",
        description: "Preview/apply/reset Cursor project-local wire-in",
      },
      {
        command: "wire zed",
        description: "Preview/apply/reset Zed project-local wire-in",
      },
      {
        command: "wire claude-code",
        description: "Preview/apply/reset Claude Code project-local wire-in",
      },
      {
        command: "wire pi",
        description: "Preview/apply/reset Pi project-local wire-in",
      },
      {
        command: "setup doctor",
        description: "Check config, host readiness, and guided setup notes",
      },
      {
        command: "doctor",
        description: "Alias for setup doctor",
      },
      {
        command: "setup hosts",
        description: "List registered host adapters",
      },
      {
        command: "setup login",
        description: "Print provider-specific login/OAuth guidance",
      },
      {
        command: "mirror plan",
        description: "Build a mirror readiness plan from current outputs",
      },
    ],
    sections: [
      {
        title: "Global options:",
        lines: [
          "--state-root <path> Write mutable lifecycle state under this path",
          "--no-dotenv         Do not load .env from the current working directory",
        ],
      },
    ],
  });
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
