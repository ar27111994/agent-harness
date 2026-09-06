#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from "node:url";

import { loadDotEnvFile } from "./config/env-file.js";
import { clearRuntimeConfig } from "./config/runtime.js";
import { runDiscover } from "./discover.js";
import { resolveProjectRoot } from "./files.js";
import { clearGitHubState } from "./github.js";
import { runInstall } from "./install.js";
import { printCommandHelp } from "./lib/cli-output.js";
import {
  printUnknownArgumentError,
  CliUsageError,
  printCliUsageError,
} from "./cli-help-format.js";
import { runMirror } from "./mirror.js";
import { runRecommend } from "./recommend.js";
import { runQuarantine } from "./quarantine.js";
import { runActivate } from "./activate.js";
import { runRebuild } from "./rebuild.js";
import { runWorkspace } from "./workspace.js";
import { runSetup } from "./setup.js";
import { runWire } from "./wire.js";
import { resolveStateRoot, prepareStateRoot } from "./lib/state-root.js";
import {
  resolveTimeoutSeconds,
  createDeadline,
  setActiveDeadline,
} from "./lib/deadline.js";

async function readPackageVersion(
  pkgRoot: string = resolveProjectRoot(fileURLToPath(import.meta.url)),
): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const pkgPath = join(pkgRoot, "package.json");
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
  if (!globalOptions.noDotEnv) await loadDotEnvFile(workingDirectory);
  clearRuntimeConfig();
  clearGitHubState();
  const preparedStateRoot = resolveStateRoot({
    packageRoot,
    workingDirectory,
    explicitStateRoot: globalOptions.stateRoot,
  });
  await prepareStateRoot(preparedStateRoot);
  const projectRoot = preparedStateRoot.stateRoot;
  setActiveDeadline(
    createDeadline(
      globalOptions.timeoutSeconds ?? resolveTimeoutSeconds(undefined),
    ),
  );

  try {
    return await runDomainCommand(domain, args, workingDirectory, projectRoot);
  } catch (error) {
    if (error instanceof CliUsageError) {
      printCliUsageError(error, `agent-harness ${domain} --help`);
      return 1;
    }
    throw error;
  }
}

/** Dispatches one CLI domain and returns its process exit code. */
export async function runDomainCommand(
  domain: string | undefined,
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  switch (domain) {
    case "discover":
      return runDiscover(args, workingDirectory, projectRoot);
    case "mirror":
      return runMirror(args, workingDirectory, projectRoot);
    case "bundle":
      if (args.length === 0)
        return runMirror(["help"], workingDirectory, projectRoot);
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
      printUnknownArgumentError(domain);
      return 1;
  }
}

interface GlobalCliOptions {
  args: string[];
  stateRoot?: string;
  noDotEnv: boolean;
  timeoutSeconds?: number;
}

function isHelpRequest(args: string[]): boolean {
  return (
    args.length === 0 ||
    args[0] === "help" ||
    args.includes("--help") ||
    args.includes("-h") ||
    (args.length === 1 && HELP_DEFAULT_DOMAINS.has(args[0]))
  );
}

function isVersionRequest(args: string[]): boolean {
  return args.includes("--version") || args.includes("-V");
}

function runHelpCommand(
  args: string[],
  workingDirectory: string,
): Promise<number> {
  const wasHelpRequested =
    args.includes("--help") || args.includes("-h") || args[0] === "help";

  const nonFlagArgs = args.filter(
    (arg) => arg !== "--help" && arg !== "-h" && arg !== "help",
  );

  if (nonFlagArgs.length >= 2) {
    const [domain, subcommand, ...extra] = nonFlagArgs;
    const domainArgs = [subcommand, ...extra];
    if (wasHelpRequested) domainArgs.push("--help");
    switch (domain) {
      case "discover":
        return runDiscover(domainArgs, workingDirectory, "");
      case "recommend":
        return runRecommend(domainArgs, workingDirectory, "");
      case "mirror":
        return runMirror(domainArgs, workingDirectory, "");
      case "bundle":
        if (domainArgs[0] !== "explain") {
          printUnknownArgumentError(domainArgs[0]);
          return Promise.resolve(1);
        }
        return runMirror(
          mapBundleSubcommandForHelp(domainArgs),
          workingDirectory,
          "",
        );
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
      printUnknownArgumentError(domain);
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

function mapBundleSubcommandForHelp(args: string[]): string[] {
  const subcommand = args[0];
  if (subcommand === "explain") return ["bundle-explain", ...args.slice(1)];
  return args;
}

function parseGlobalOptions(args: string[]): GlobalCliOptions {
  const nextArgs: string[] = [];
  let stateRoot: string | undefined;
  let noDotEnv = false;
  let timeoutSeconds: number | undefined;

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
      if (!value) throw new Error("--state-root requires a path value");
      stateRoot = value;
      continue;
    }
    if (arg === "--timeout-seconds") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--timeout-seconds requires a number value");
      }
      timeoutSeconds = resolveTimeoutSeconds(value);
      if (timeoutSeconds === undefined) {
        throw new Error(
          `--timeout-seconds requires a positive number, got "${value}"`,
        );
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--timeout-seconds=")) {
      const value = arg.slice("--timeout-seconds=".length);
      if (!value) throw new Error("--timeout-seconds requires a number value");
      timeoutSeconds = resolveTimeoutSeconds(value);
      if (timeoutSeconds === undefined) {
        throw new Error(
          `--timeout-seconds requires a positive number, got "${value}"`,
        );
      }
      continue;
    }
    if (arg === "--no-dotenv") {
      noDotEnv = true;
      continue;
    }
    nextArgs.push(arg);
  }

  return { args: nextArgs, stateRoot, noDotEnv, timeoutSeconds };
}

function printHelp(): void {
  printCommandHelp({
    heading: "agent-harness",
    entries: [],
    sections: [
      {
        title: "Quick start:",
        lines: [
          "  agent-harness setup doctor           Check host readiness and prerequisites",
          "  agent-harness workspace opencode       Full pipeline for OpenCode",
          "  agent-harness workspace vscode         Full pipeline for VS Code/Copilot",
          "  agent-harness workspace cursor         Full pipeline for Cursor",
          "",
          "  Discovery pipeline: demand-profile -> sources -> sync (optional cache/index refresh) -> catalog -> select -> recommend report",
          "  Outputs: mutable discovery/recommendation artifacts are written under <state-root>/discover/output and <state-root>/state.",
          "  Shortcut: 'discover full' runs demand-profile -> sources -> sync -> catalog -> select; then run 'recommend report'.",
          "",
          "  Run 'agent-harness <command> --help' for detailed command options.",
        ],
      },
      {
        title: "Discover — scan workspaces and build asset catalogs:",
        lines: [
          "  discover demand-profile     Scan the working directory for demand signals",
          "  discover sources            Summarize enabled asset-producing discovery sources",
          "  discover sync               Optional refresh/persist step for high-volume indexed sources",
          "  discover index              Build full offline catalog index (500 pages per source)",
          "  discover catalog            Build the unified asset catalog (can harvest without prior sync)",
          "  discover select             Apply canonical selection policies",
          "  discover full               Run demand-profile -> sources -> sync -> catalog -> select",
          "  discover breadth            Widest discovery pass with candidate-pool guidance",
          "  discover recall             Alias for discover breadth",
          "  discover candidate-pool     Alias for discover breadth",
          "  discover stats              Print catalog and source statistics",
          "  discover diff               Compare outputs against a baseline state root",
          "  discover environment-index  Write experimental read-only query metadata index",
          "  discover ard-export         Export selected catalog to ARD ai-catalog.json",
          "  discover enrich             Run AI-assisted enrichment on the catalog",
          "  discover inspect            Print catalog entries with optional filters",
        ],
      },
      {
        title: "Recommend — score and rank assets for your workspace:",
        lines: [
          "  recommend report            Build a scored report (requires discover select outputs)",
          "  recommend ai-review         Run recommendation-native AI review (--apply to rewrite report)",
          "  recommend explain           Explain why an asset was selected, rejected, or pruned",
          "  recommend evaluate          Evaluate recommendation quality and host fit",
          "  recommend policy:print      Print the merged effective policy",
        ],
      },
      {
        title: "Mirror & Install — acquire and stage verified assets:",
        lines: [
          "  mirror locks                Generate mirror bundle locks",
          "  mirror acquire              Acquire raw mirror artifacts",
          "  mirror bundle-explain       Explain bundle lock contents",
          "  mirror plan                 Build a mirror readiness plan",
          "  mirror diff                 Compare current mirror index to previous snapshot",
          "  mirror explain              Explain a mirrored artifact by --asset or --mirror",
          "  install bundle              Stage mirrored assets from mirror bundle locks",
          "  install native              Plan/verify/apply/remove host-native installs",
          "  install refresh             Refresh staged install state and report/apply stale assets",
          "  install reconcile           Recompute staged install progress from manifests",
          "  install diff                Compare current vs previous install generations",
          "  install explain             Explain where a staged asset is present and active",
          "  install generations         Manage generation list, pinning, and pruning",
          "  install reset               Remove staged install state, packages, and bundles",
        ],
      },
      {
        title: "Activate & Wire — link installed assets into host workspaces:",
        lines: [
          "  activate host --host opencode  Activate assets for OpenCode/Codex/Pi host family",
          "  activate host --host vscode    Activate assets for VS Code/Cursor host family",
          "  activate diff                 Compare activation states between generations",
          "  activate explain              Explain why an installed asset is active or not",
          "  activate rollback             Roll back activation to a previous generation",
          "  wire vscode                   Preview/apply/reset VS Code user-scoped wire-in",
          "  wire opencode                 Preview/apply/reset OpenCode project-local wire-in",
          "  wire cursor                   Preview/apply/reset Cursor project-local wire-in",
          "  wire zed                      Preview/apply/reset Zed project-local wire-in",
          "  wire claude-code              Preview/apply/reset Claude Code project-local wire-in",
          "  wire pi                       Preview/apply/reset Pi project-local wire-in",
          "  wire codex                    Preview/apply/reset Codex project-local wire-in",
        ],
      },
      {
        title: "Workspace — full lifecycle pipeline for a single host:",
        lines: [
          "  workspace vscode            Full pipeline for VS Code/Copilot",
          "  workspace opencode          Full pipeline for OpenCode",
          "  workspace cursor            Full pipeline for Cursor",
          "  workspace zed               Full pipeline for Zed",
          "  workspace claude-code       Full pipeline for Claude Code",
          "  workspace pi                Full pipeline for Pi",
          "  workspace codex             Full pipeline for Codex",
        ],
      },
      {
        title: "Setup & Doctor — check and configure your environment:",
        lines: [
          "  setup doctor                Check config, host readiness, and guided setup notes",
          "  setup hosts                 List registered host adapters and capabilities",
          "  setup login                 Print provider-specific login/OAuth guidance",
        ],
      },
      {
        title: "Quarantine — review and manage quarantined mirror artifacts:",
        lines: [
          "  quarantine list             List quarantined mirror artifacts pending review",
          "  quarantine inspect          Show quarantined artifact metadata and content preview",
          "  quarantine report           Write state/quarantine/quarantine-state.json",
          "  quarantine approve          Mark a quarantined artifact approved-with-warning",
          "  quarantine reject           Record a rejection while keeping quarantine status",
          "  quarantine pin              Pin a quarantine decision for future reviews",
        ],
      },
      {
        title:
          "Rebuild & Bundle — clean, rebuild, and inspect lifecycle state:",
        lines: [
          "  rebuild clean               Remove install/activate transient state",
          "  rebuild full                Clean and regenerate discover/mirror/install/activate",
          "  bundle explain <bundleId>   Explain why assets are present in a bundle lock",
        ],
      },
      {
        title: "Global options:",
        lines: [
          "  --state-root <path>     Write mutable lifecycle state under this path",
          "  --timeout-seconds <n>   Deadline in seconds (clamped 10–3600). Also via AGENT_HARNESS_TIMEOUT_SECONDS env var.",
          "  --no-dotenv             Do not load .env from the current working directory",
        ],
      },
    ],
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

/** Exposes CLI dispatch helpers for focused tests. */
export const cliInternals = {
  mapBundleSubcommandForHelp,
  runDomainCommand,
  runHelpCommand,
  parseGlobalOptions,
  resolveHelpDomain,
  isHelpRequest,
  isVersionRequest,
  readPackageVersion,
  main,
};
