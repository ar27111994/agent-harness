import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readTextFileOrNull, writeJsonFile, writeTextFile } from "../files.js";
import { wireNativeHost } from "../host-adapters/native-wire.js";
import { wireOpenCode } from "../host-adapters/opencode.js";

void test("native reset rejects wire-plan text snapshots outside the managed restore set", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-native-wire-security-"),
  );

  try {
    const projectRoot = join(root, "project");
    const workspaceRoot = join(root, "workspace");
    const escapedPath = join(root, "escaped.txt");

    await writeTextFile(escapedPath, "do-not-touch");
    await writeJsonFile(join(projectRoot, "activate", "pi", "wire-plan.json"), {
      schemaVersion: 1,
      host: "pi",
      generatedAt: new Date().toISOString(),
      workspaceRoot,
      runtimeRoot: join(workspaceRoot, ".pi", "agent-harness"),
      notes: ["malicious fixture"],
      textFileSnapshots: [
        {
          path: escapedPath.replace(/\\/gu, "/"),
          content: "overwritten",
        },
      ],
    });

    await assert.rejects(
      wireNativeHost("pi", {
        projectRoot,
        workspaceRoot,
        mode: "reset",
      }),
      /outside the managed restore set/u,
    );
    assert.equal(await readTextFileOrNull(escapedPath), "do-not-touch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("OpenCode reset rejects wire-plan text snapshots outside the managed restore set", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-opencode-security-"),
  );

  try {
    const projectRoot = join(root, "project");
    const workspaceRoot = join(root, "workspace");
    const escapedPath = join(root, "escaped.txt");

    await writeTextFile(escapedPath, "do-not-touch");
    await writeJsonFile(
      join(
        workspaceRoot,
        ".opencode",
        "context",
        "project-intelligence",
        "agent-harness",
        "wire-plan.json",
      ),
      {
        schemaVersion: 1,
        host: "opencode-project",
        generatedAt: new Date().toISOString(),
        workspaceRoot,
        runtimeRoot: join(
          workspaceRoot,
          ".opencode",
          "context",
          "project-intelligence",
          "agent-harness",
        ),
        notes: ["malicious fixture"],
        textFileSnapshots: [
          {
            path: escapedPath.replace(/\\/gu, "/"),
            content: "overwritten",
          },
        ],
      },
    );

    await assert.rejects(
      wireOpenCode({
        projectRoot,
        workspaceRoot,
        mode: "reset",
      }),
      /outside the managed OpenCode restore set/u,
    );
    assert.equal(await readTextFileOrNull(escapedPath), "do-not-touch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
