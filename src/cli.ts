#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { runDiscover } from "./discover.js";
import { resolveProjectRoot } from "./files.js";
import { runInstall } from "./install.js";
import { runMirror } from "./mirror.js";
import { runRecommend } from "./recommend.js";
import { runActivate } from "./activate.js";
import { runRebuild } from "./rebuild.js";
import { runWorkspace } from "./workspace.js";
import { runSetup } from "./setup.js";
import { runWire } from "./wire.js";

async function main(): Promise<number> {
  const [, , domain, ...args] = process.argv;
  const projectRoot = resolveProjectRoot(fileURLToPath(import.meta.url));
  const workingDirectory = process.cwd();

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
    case "rebuild":
      return runRebuild(args, workingDirectory, projectRoot);
    case "workspace":
      return runWorkspace(args, workingDirectory, projectRoot);
    case "wire":
      return runWire(args, workingDirectory, projectRoot);
    case "setup":
    case "doctor":
      return runSetup(domain === "doctor" ? ["doctor", ...args] : args);
    case undefined:
      printHelp();
      return 0;
    default:
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(`agent-harness commands:
  discover demand-profile   Scan the working directory and emit a demand profile
  discover sources          Summarize enabled discovery sources
  discover catalog          Build the unified asset catalog
  discover select          Apply canonical selection policies
  discover stats           Print catalog/source stats
  mirror locks             Generate mirror bundle locks
  mirror acquire           Acquire raw mirror artifacts and resolve bundle locks
  install bundle            Stage installed assets from bundle locks
  install reconcile         Recompute install progress and generations
  install reset             Remove install state
  activate host             Materialize active host views from installed bundles
  activate rollback         Point a host to a previous generation
  activate reset            Remove activation state
  recommend report          Recompute the recommendation report
  recommend explain         Explain why an asset ranked for a host
  recommend evaluate        Run golden recommendation fixtures
  rebuild clean             Remove install/activate transient state for a clean rebuild
  rebuild full              Clean and regenerate discover/mirror/install/activate state
  workspace vscode          Run the full pipeline for a VS Code / Copilot workspace
  workspace opencode        Run the full pipeline for an OpenCode workspace
  wire vscode               Preview/apply/reset VS Code user-scoped wire-in
  wire opencode             Preview/apply/reset OpenCode project-local wire-in
  setup doctor              Check config, host readiness, and guided setup notes
  setup hosts               List registered host adapters
  mirror plan               Build a mirror readiness plan from current outputs`);
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
