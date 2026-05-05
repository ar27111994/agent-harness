import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { clearRuntimeConfig } from "../config/runtime.js";
import { writeJsonFile, removePath } from "../files.js";
import { resolveHostAdapter } from "../host-adapters/registry.js";
import { resolveDefaultOpenCodeConfigRoot } from "../lib/paths.js";
import { prepareStateRoot } from "../lib/state-root.js";
import { runWorkspacePipeline } from "../pipeline.js";

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const hosts = ["vscode", "opencode", "cursor", "zed", "claude-code", "pi"];

const tempRoot = await mkdtemp(
  join(tmpdir(), "agent-harness-workspace-smoke-"),
);
try {
  process.env.AGENT_HARNESS_HOME = join(tempRoot, "home");
  process.env.APPDATA = join(tempRoot, "appdata");
  process.env.HOME = join(tempRoot, "home");
  process.env.USERPROFILE = join(tempRoot, "home");
  process.env.XDG_CONFIG_HOME = join(tempRoot, "xdg");
  clearRuntimeConfig();

  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const localOpenCodeRoot = resolveDefaultOpenCodeConfigRoot();

  await mkdir(join(localOpenCodeRoot, "skills", "repo-guide"), {
    recursive: true,
  });
  await mkdir(join(localOpenCodeRoot, "agent"), { recursive: true });
  await mkdir(join(localOpenCodeRoot, "commands"), { recursive: true });
  await writeFile(
    join(localOpenCodeRoot, "skills", "repo-guide", "SKILL.md"),
    "---\nname: repo-guide\ndescription: Repository guidance\ntags: [documentation, testing]\n---\n# Repo Guide\nUse this repository guidance.\n",
    "utf8",
  );
  await writeFile(
    join(localOpenCodeRoot, "agent", "reviewer.md"),
    "# Reviewer\nReview code changes for this repository.\n",
    "utf8",
  );
  await writeFile(
    join(localOpenCodeRoot, "commands", "review.md"),
    "---\ndescription: Review current changes\n---\nReview the current changes and suggest fixes.\n",
    "utf8",
  );
  await writeFile(join(workspaceRoot, "README.md"), "# Workspace\n", "utf8");

  await prepareStateRoot({
    packageRoot,
    stateRoot,
    usesPackageRoot: false,
  });
  await removePath(join(stateRoot, "discover", "source-packs"));
  await writeJsonFile(
    join(stateRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [],
    },
  );
  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      {
        id: "local-opencode-config",
        name: "Workspace Local OpenCode Config",
        kind: "local-directory",
        authorityTier: "trusted-local",
        publisher: { name: "workspace-local", verified: true },
        hosts: ["copilot-vscode", "opencode"],
        assetKinds: ["skill", "agent", "plugin", "prompt-pack"],
        discoveryMode: "seed",
        priority: 100,
        enabled: true,
        endpoints: { path: localOpenCodeRoot },
        rules: {
          officialPreferred: true,
          allowMirror: true,
          allowInstall: true,
        },
      },
    ],
  });

  for (const host of hosts) {
    const adapter = resolveHostAdapter(host);
    if (!adapter) {
      throw new Error(`Unknown workspace smoke host: ${host}`);
    }

    await runWorkspacePipeline({
      projectRoot: stateRoot,
      workspaceRoot,
      targetHost: adapter.lifecycleHost,
      recommendationHost: adapter.recommendationHost,
      sessionIntent: "testing",
      bundleIds: adapter.defaultBundleIds,
    });
    await adapter.wire({
      projectRoot: stateRoot,
      workspaceRoot,
      mode: "preview",
    });
  }

  console.log(`Workspace smoke completed with state root ${stateRoot}`);
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}
