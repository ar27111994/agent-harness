#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { loadDotEnvFile } from "./config/env-file.js";
import { clearRuntimeConfig } from "./config/runtime.js";
import { runDiscover } from "./discover.js";
import { resolveProjectRoot } from "./files.js";
import { clearGitHubState } from "./github.js";
import { runInstall } from "./install.js";
import { runMirror } from "./mirror.js";
import { runRecommend } from "./recommend.js";
import { runQuarantine } from "./quarantine.js";
import { runActivate } from "./activate.js";
import { runRebuild } from "./rebuild.js";
import { runWorkspace } from "./workspace.js";
import { runSetup } from "./setup.js";
import { runWire } from "./wire.js";
import { prepareStateRoot, resolveStateRoot } from "./lib/state-root.js";

const HELP_DEFAULT_DOMAINS = new Set([
  "activate",
  "discover",
  "install",
  "mirror",
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
    case "install":
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

function runHelpCommand(
  args: string[],
  workingDirectory: string,
): Promise<number> {
  const domain = resolveHelpDomain(args);

  switch (domain) {
    case "discover":
      return runDiscover(["help"], workingDirectory, "");
    case "mirror":
      return runMirror(["help"], workingDirectory, "");
    case "install":
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
  console.log(`agent-harness commands:
  discover demand-profile   Scan the working directory and emit a demand profile
  discover sources          Summarize enabled discovery sources
  discover catalog          Build the unified asset catalog
  discover select           Apply canonical selection policies
  discover full             Run demand-profile, sources, catalog, and select in one pass
  discover stats            Print catalog/source stats
  mirror locks             Generate mirror bundle locks
  mirror acquire           Acquire raw mirror artifacts and resolve bundle locks
  install bundle            Stage installed assets from bundle locks
  install native            Plan/verify/apply/remove host-native installs
  install reconcile         Recompute install progress and generations
  install reset             Remove install state
  activate host             Materialize active host views from installed bundles
  activate rollback         Point a host to a previous generation
  activate reset            Remove activation state
  recommend report          Recompute the recommendation report
  recommend ai-review       Run bounded recommendation-native AI review
  recommend explain         Explain why an asset ranked for a host
  recommend evaluate        Run golden recommendation fixtures
  quarantine list           List, inspect, approve, or reject quarantined mirror artifacts
  rebuild clean             Remove install/activate transient state for a clean rebuild
  rebuild full              Clean and regenerate discover/mirror/install/activate state
  workspace vscode          Run the full pipeline for a VS Code / Copilot workspace
  workspace opencode        Run the full pipeline for an OpenCode workspace
  workspace cursor          Run the Copilot-compatible pipeline and wire Cursor project files
  workspace zed             Run the OpenCode-compatible pipeline and wire Zed project files
  workspace claude-code     Run the OpenCode-compatible pipeline and wire Claude Code project files
  workspace pi              Run the OpenCode-compatible pipeline and wire Pi project files
  wire vscode               Preview/apply/reset VS Code user-scoped wire-in
  wire opencode             Preview/apply/reset OpenCode project-local wire-in
  wire cursor               Preview/apply/reset Cursor project-local wire-in
  wire zed                  Preview/apply/reset Zed project-local wire-in
  wire claude-code          Preview/apply/reset Claude Code project-local wire-in
  wire pi                   Preview/apply/reset Pi project-local wire-in
  setup doctor              Check config, host readiness, and guided setup notes
  doctor                    Alias for setup doctor
  setup hosts               List registered host adapters
  setup login               Print provider-specific login/OAuth guidance
  mirror plan               Build a mirror readiness plan from current outputs

Global options:
  --state-root <path>       Write mutable lifecycle state under this path
  --no-dotenv               Do not load .env from the current working directory`);
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
