#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { resolveHostAdapter } from "./host-adapters/registry.js";
import { runWorkspacePipeline } from "./pipeline.js";

const [, , ...args] = process.argv;
const intentIndex = args.indexOf("--intent");
const sessionIntent =
  intentIndex >= 0 ? (args[intentIndex + 1] ?? "general") : "general";
const projectRoot = resolveProjectRoot(fileURLToPath(import.meta.url));
const workingDirectory = process.cwd();
const hostAdapter = resolveHostAdapter("opencode");

if (!hostAdapter) {
  throw new Error("OpenCode host adapter is not registered.");
}

runWorkspacePipeline({
  projectRoot,
  workspaceRoot: workingDirectory,
  targetHost: hostAdapter.lifecycleHost,
  recommendationHost: hostAdapter.recommendationHost,
  sessionIntent,
  bundleIds: hostAdapter.defaultBundleIds,
})
  .then(async () => {
    await hostAdapter.wire({
      projectRoot,
      workspaceRoot: workingDirectory,
      mode: "apply",
    });
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
