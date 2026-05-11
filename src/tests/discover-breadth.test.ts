import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { runDiscover } from "../discover.js";

void test("discover breadth runs the full breadth workflow and prints guidance", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-breadth-"),
  );
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  const localSourceRoot = join(tempRoot, "local-source");
  const homeRoot = join(tempRoot, "home");
  const appDataRoot = join(tempRoot, "appdata");
  const xdgConfigRoot = join(tempRoot, "xdg");
  const stdoutChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };

  try {
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(stateRoot, { recursive: true });
    await mkdir(homeRoot, { recursive: true });
    await mkdir(appDataRoot, { recursive: true });
    await mkdir(xdgConfigRoot, { recursive: true });
    await writeText(
      join(workspaceRoot, "package.json"),
      JSON.stringify(
        {
          name: "workspace",
          private: true,
          dependencies: {
            react: "^19.0.0",
            typescript: "^5.0.0",
          },
        },
        null,
        2,
      ),
    );
    await writeText(
      join(workspaceRoot, "README.md"),
      "React frontend workspace with testing and UI concerns.\n",
    );
    await writeText(join(localSourceRoot, "AGENTS.md"), "Project guidance\n");
    await writeText(
      join(localSourceRoot, "skills", "react-helper", "SKILL.md"),
      "---\nname: react-helper\ndescription: React helper\n---\n# React helper\n",
    );

    await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        {
          id: "local-workspace-guidance",
          name: "local-workspace-guidance",
          kind: "local-directory",
          authorityTier: "trusted-local",
          publisher: { name: "local", verified: true },
          hosts: ["copilot-vscode"],
          assetKinds: ["skill", "instruction", "prompt-pack", "agent"],
          discoveryMode: "catalog",
          priority: 100,
          enabled: true,
          endpoints: { path: localSourceRoot },
          rules: {
            officialPreferred: true,
            allowMirror: true,
            allowInstall: true,
          },
        },
      ],
    });
    await writeJsonFile(join(stateRoot, "discover", "selections.json"), {
      schemaVersion: 1,
      selectionPolicies: {
        officialBeatsPopularity: true,
        starsAreTieBreakerOnly: true,
        preferNativeOverAdaptable: true,
        preferLowerRiskWhenEquivalent: true,
        preferLowerContextCostWhenEquivalent: true,
        communityDefaultPolicy: "catalog-only-unless-promoted",
      },
      rankingOrder: [],
      duplicateGroups: [],
    });

    process.env.AGENT_HARNESS_HOME = homeRoot;
    process.env.APPDATA = appDataRoot;
    process.env.HOME = homeRoot;
    process.env.USERPROFILE = homeRoot;
    process.env.XDG_CONFIG_HOME = xdgConfigRoot;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stdout.write;

    assert.equal(await runDiscover(["breadth"], workspaceRoot, stateRoot), 0);

    const stdout = stdoutChunks.join("");
    assert.match(stdout, /Discovery breadth complete\./u);
    assert.match(stdout, /Assessment: /u);
    assert.match(stdout, /Next steps:/u);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.env.AGENT_HARNESS_HOME = previousEnv.AGENT_HARNESS_HOME;
    process.env.APPDATA = previousEnv.APPDATA;
    process.env.HOME = previousEnv.HOME;
    process.env.USERPROFILE = previousEnv.USERPROFILE;
    process.env.XDG_CONFIG_HOME = previousEnv.XDG_CONFIG_HOME;
    await rm(tempRoot, { force: true, recursive: true });
  }
});

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
