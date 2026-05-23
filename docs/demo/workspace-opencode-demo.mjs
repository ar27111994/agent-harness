#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const workspaceRoot = join(
  repositoryRoot,
  ".tmp",
  `demo-workspace-opencode-${process.pid}`,
);
const cliPath = join(repositoryRoot, "dist", "cli.js");

await rm(workspaceRoot, { recursive: true, force: true });
await createDemoWorkspace(workspaceRoot);

await createDemoOutputs(workspaceRoot);
await run("node", ["-e", printWorkspaceTranscriptScript()], workspaceRoot);
await run(
  "node",
  [cliPath, "--state-root", ".agent-harness", "setup", "hosts"],
  workspaceRoot,
);
await run("node", ["-e", printTreeScript()], workspaceRoot);

async function createDemoWorkspace(root) {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "agent-harness-demo-workspace",
        private: true,
        type: "module",
        scripts: {
          test: "node --test",
        },
        dependencies: {
          express: "latest",
          zod: "latest",
        },
        devDependencies: {
          typescript: "latest",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(root, "README.md"),
    "# Agent Harness Demo Workspace\n\nSmall public-safe workspace for recording the OpenCode quick start.\n",
    "utf8",
  );
  await writeFile(
    join(root, "src", "server.ts"),
    "export const health = () => ({ ok: true });\n",
    "utf8",
  );
}

async function createDemoOutputs(root) {
  const files = new Map([
    [
      ".agent-harness/discover/output/demand-profile.json",
      { intents: ["general"], signals: ["typescript", "api"] },
    ],
    [
      ".agent-harness/discover/output/source-index.json",
      { selectedSources: ["opencode-docs", "github-awesome-copilot"] },
    ],
    [
      ".agent-harness/discover/output/selection-report.json",
      { selected: 12, rejected: 3 },
    ],
    [
      ".agent-harness/state/recommendations.json",
      { host: "opencode", recommendations: ["repo-guide", "api-reviewer"] },
    ],
    [
      ".agent-harness/mirror/bundles/opencode-global.lock.json",
      { bundleId: "opencode-global", assets: 2 },
    ],
    [
      ".agent-harness/activate/opencode/activation-manifest.json",
      { host: "opencode", activeAssets: 2 },
    ],
    [
      ".agent-harness/activate/opencode/wire-preview-opencode.json",
      { mode: "preview", target: "opencode" },
    ],
    [
      ".opencode/context/project-intelligence/agent-harness/wire-plan.json",
      { mode: "apply", managed: true },
    ],
  ]);

  for (const [relativePath, content] of files) {
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(
      absolutePath,
      `${JSON.stringify(content, null, 2)}\n`,
      "utf8",
    );
  }

  await writeFile(
    join(root, "AGENTS.md"),
    "# AGENTS.md\n\n<!-- agent-harness:start -->\nManaged OpenCode context.\n<!-- agent-harness:end -->\n",
    "utf8",
  );
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`\n$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "off",
        AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1",
        AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS: "20",
        AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY: "5",
        GITHUB_TOKEN: "",
        GITHUB_PERSONAL_ACCESS_TOKEN: "",
      },
      stdio: "inherit",
      shell: false,
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function printWorkspaceTranscriptScript() {
  return `
console.log("$ agent-harness workspace opencode --intent general");
console.log("[workspace opencode] Starting OpenCode workspace pipeline...");
console.log("[workspace] 1/11 Scanning workspace demand...");
console.log("[workspace] 2/11 Refreshing source index...");
console.log("[workspace] 3/11 Syncing indexed sources...");
console.log("[workspace] 4/11 Refreshing source index after sync...");
console.log("[workspace] 5/11 Building discovery catalog...");
console.log("[workspace] 6/11 Applying selection rules...");
console.log("[workspace] 7/11 Ranking recommendations...");
console.log("[workspace] 8/11 Planning mirror work...");
console.log("[workspace] 9/11 Preparing mirror locks...");
console.log("[workspace] 10/11 Acquiring and staging assets...");
console.log("[workspace] 11/11 Activating host views...");
console.log("[workspace opencode] Applying OpenCode wire-in...");
console.log("[workspace opencode] Complete. Review .agent-harness/ and project-local .opencode outputs.");
`;
}

function printTreeScript() {
  return `
const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const roots = [".agent-harness/discover/output", ".agent-harness/state", ".agent-harness/mirror/bundles", ".agent-harness/activate/opencode", ".opencode", "AGENTS.md"];
for (const root of roots) {
  console.log("\\n" + root);
  print(root, "  ", 2);
}
function print(path, prefix, depth) {
  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(path).sort().slice(0, 8)) {
      const child = join(path, entry);
      const childStat = statSync(child);
      console.log(prefix + entry + (childStat.isDirectory() ? "/" : ""));
      if (childStat.isDirectory() && depth > 0) print(child, prefix + "  ", depth - 1);
    }
  } catch {}
}
`;
}
