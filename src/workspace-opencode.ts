#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { resolveProjectRoot } from "./files.js";
import { wireOpenCode } from "./host-opencode.js";
import { runWorkspacePipeline } from "./pipeline.js";

const [, , ...args] = process.argv;
const intentIndex = args.indexOf("--intent");
const sessionIntent =
  intentIndex >= 0 ? (args[intentIndex + 1] ?? "general") : "general";
const projectRoot = resolveProjectRoot(fileURLToPath(import.meta.url));
const workingDirectory = process.cwd();

runWorkspacePipeline({
  projectRoot,
  workspaceRoot: workingDirectory,
  targetHost: "opencode",
  sessionIntent,
  bundleIds: ["opencode-global", "community-stable", "shared-mcp"],
})
  .then(() =>
    wireOpenCode({
      projectRoot,
      workspaceRoot: workingDirectory,
      mode: "apply",
    }),
  )
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
