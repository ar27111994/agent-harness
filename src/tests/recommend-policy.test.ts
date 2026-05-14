import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runRecommend } from "../recommend/commands.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

void test("recommendation policy loads package defaults by default", async () => {
  await withPolicyWorkspace(async (projectRoot) => {
    const policy = await loadRecommendationPolicy(projectRoot);

    assert.equal(policy.hosts["copilot-vscode"].recommendationLimit, 240);
    assert.equal(
      policy.hosts["copilot-vscode"].recommendationLimitOverrideMode,
      "preserve",
    );
    assert.equal(policy.hosts["copilot-vscode"].maxPerAssetKind.skill, 72);
  });
});

void test("recommendation policy merges user-owned base and host overrides", async () => {
  await withPolicyWorkspace(async (projectRoot) => {
    await writePolicyFile(projectRoot, join("overrides", "base.json"), {
      schemaVersion: 1,
      concernKeywordMap: {
        custom: ["user-owned-policy"],
      },
    });
    await writePolicyFile(
      projectRoot,
      join("overrides", "hosts", "copilot-vscode.json"),
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        policy: {
          recommendationLimit: 32,
          maxPerAssetKind: {
            skill: 9,
          },
        },
      },
    );

    const policy = await loadRecommendationPolicy(projectRoot);

    assert.equal(policy.concernKeywordMap.custom?.[0], "user-owned-policy");
    assert.equal(policy.hosts["copilot-vscode"].recommendationLimit, 32);
    assert.equal(policy.hosts["copilot-vscode"].maxPerAssetKind.skill, 9);
  });
});

void test("recommend policy:print shows the effective policy with user overrides", async (t) => {
  await withPolicyWorkspace(async (projectRoot) => {
    await writePolicyFile(
      projectRoot,
      join("overrides", "hosts", "copilot-vscode.json"),
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        policy: {
          recommendationLimit: 28,
          recommendationLimitOverrideMode: "scale",
        },
      },
    );

    const output: string[] = [];
    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    const exitCode = await runRecommend(
      ["policy:print", "--host", "vscode", "--compact"],
      projectRoot,
      projectRoot,
    );

    assert.equal(exitCode, 0);
    const printedPolicy = JSON.parse(output.join("\n")) as {
      hostPolicy: {
        recommendationLimit: number;
        recommendationLimitOverrideMode: string;
      };
    };
    assert.equal(printedPolicy.hostPolicy.recommendationLimit, 28);
    assert.equal(
      printedPolicy.hostPolicy.recommendationLimitOverrideMode,
      "scale",
    );
  });
});

async function withPolicyWorkspace(
  callback: (projectRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-policy-"));
  const projectRoot = join(tempRoot, "workspace");
  const packagePolicyRoot = join(
    repositoryRoot,
    "discover",
    "recommendation-policy",
  );
  const targetPolicyRoot = join(
    projectRoot,
    "discover",
    "recommendation-policy",
  );

  try {
    await mkdir(projectRoot, { recursive: true });
    await cp(packagePolicyRoot, targetPolicyRoot, { recursive: true });
    await callback(projectRoot);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function writePolicyFile(
  projectRoot: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const filePath = join(
    projectRoot,
    "discover",
    "recommendation-policy",
    relativePath,
  );
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
