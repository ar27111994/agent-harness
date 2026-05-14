import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { runRecommend } from "../recommend/commands.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

void test("recommendation policy loads package defaults by default", async () => {
  await withClearedRecommendationLimitEnv(async () => {
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
});

void test("recommendation policy merges user-owned base and host overrides", async () => {
  await withClearedRecommendationLimitEnv(async () => {
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
});

void test("recommend policy:print shows the effective policy with user overrides", async (t) => {
  await withClearedRecommendationLimitEnv(async () => {
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
        runtimeOverrides: {
          recommendationLimitOverrideMode: string;
          recommendationLimitOverrideModeSource: string;
          scalingApplied: boolean;
        };
      };
      assert.equal(printedPolicy.hostPolicy.recommendationLimit, 28);
      assert.equal(
        printedPolicy.hostPolicy.recommendationLimitOverrideMode,
        "scale",
      );
      assert.equal(
        printedPolicy.runtimeOverrides.recommendationLimitOverrideMode,
        "scale",
      );
      assert.equal(
        printedPolicy.runtimeOverrides.recommendationLimitOverrideModeSource,
        "policy",
      );
      assert.equal(printedPolicy.runtimeOverrides.scalingApplied, false);
    });
  });
});

void test("recommend policy:print exposes explicit scale-mode runtime metadata", async (t) => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT = "120";
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE =
        "scale";
      clearRuntimeConfigForTests();

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
          maxPerAssetKind: {
            skill: number;
          };
        };
        runtimeOverrides: {
          recommendationLimitSource: string;
          recommendationLimitOverrideModeSource: string;
          scalingApplied: boolean;
          recommendationLimitScaleFactor: number;
          recommendationLimitScaledFields: string[];
        };
      };
      assert.equal(printedPolicy.hostPolicy.recommendationLimit, 120);
      assert.equal(printedPolicy.hostPolicy.maxPerAssetKind.skill, 36);
      assert.equal(
        printedPolicy.runtimeOverrides.recommendationLimitSource,
        "env",
      );
      assert.equal(
        printedPolicy.runtimeOverrides.recommendationLimitOverrideModeSource,
        "env",
      );
      assert.equal(printedPolicy.runtimeOverrides.scalingApplied, true);
      assert.equal(
        printedPolicy.runtimeOverrides.recommendationLimitScaleFactor,
        0.5,
      );
      assert.ok(
        printedPolicy.runtimeOverrides.recommendationLimitScaledFields.includes(
          "maxPerAssetKind.skill",
        ),
      );
    });
  });
});

void test("recommend policy:print preserves explicit zero values in scale mode", async (t) => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT = "120";
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE =
        "scale";
      clearRuntimeConfigForTests();

      await writePolicyFile(
        projectRoot,
        join("overrides", "hosts", "copilot-vscode.json"),
        {
          schemaVersion: 1,
          host: "copilot-vscode",
          policy: {
            maxPerAssetKind: {
              skill: 0,
            },
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
          maxPerAssetKind: {
            skill: number;
          };
        };
        runtimeOverrides: {
          recommendationLimitScaledFields: string[];
        };
      };
      assert.equal(printedPolicy.hostPolicy.maxPerAssetKind.skill, 0);
      assert.equal(
        printedPolicy.runtimeOverrides.recommendationLimitScaledFields.includes(
          "maxPerAssetKind.skill",
        ),
        false,
      );
    });
  });
});

async function withClearedRecommendationLimitEnv(
  callback: () => Promise<void>,
): Promise<void> {
  const previousLimitEnvValue =
    process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
  const previousModeEnvValue =
    process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE;

  delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
  delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE;
  clearRuntimeConfigForTests();

  try {
    await callback();
  } finally {
    if (previousLimitEnvValue === undefined) {
      delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
    } else {
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT =
        previousLimitEnvValue;
    }
    if (previousModeEnvValue === undefined) {
      delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE;
    } else {
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE =
        previousModeEnvValue;
    }
    clearRuntimeConfigForTests();
  }
}

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
