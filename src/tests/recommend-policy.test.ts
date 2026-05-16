import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { runRecommend } from "../recommend/commands.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";
import type { RecommendationPolicy } from "../types.js";

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

void test("recommendation policy falls back to the legacy persisted policy file", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    const legacyPolicy = await loadRecommendationPolicy(repositoryRoot);
    await withEmptyPolicyWorkspace(async (projectRoot) => {
      await writePolicyJson(
        projectRoot,
        join("..", "recommendation-policy.json"),
        legacyPolicy,
      );

      const loaded = await loadRecommendationPolicy(projectRoot);

      assert.equal(
        loaded.hosts["copilot-vscode"].recommendationLimit,
        legacyPolicy.hosts["copilot-vscode"].recommendationLimit,
      );
      assert.equal(loaded.schemaVersion, legacyPolicy.schemaVersion);
      assert.equal(
        loaded.hosts.shared.suggestedBundleId,
        legacyPolicy.hosts.shared.suggestedBundleId,
      );
    });
  });
});

void test("recommendation policy merges user-owned base and host overrides", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      await writePolicyJson(projectRoot, join("overrides", "base.json"), {
        schemaVersion: 1,
        concernKeywordMap: {
          custom: ["user-owned-policy"],
        },
      });
      await writePolicyJson(
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

void test("recommendation policy rejects mismatched base override schemas", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      await writePolicyJson(projectRoot, join("overrides", "base.json"), {
        schemaVersion: 999,
      });

      await assert.rejects(
        () => loadRecommendationPolicy(projectRoot),
        /Recommendation policy schema mismatch for user base override/u,
      );
    });
  });
});

void test("recommendation policy synthesizes safe defaults when packaged host overrides are missing", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      await rm(
        join(
          projectRoot,
          "discover",
          "recommendation-policy",
          "hosts",
          "pi.json",
        ),
        { force: true },
      );

      const policy = await loadRecommendationPolicy(projectRoot);

      assert.ok(policy.hosts.pi.suggestedBundleId.length > 0);
      assert.equal(policy.hosts.pi.recommendationLimit, 12);
      assert.equal(policy.hosts.pi.recommendationLimitOverrideMode, "preserve");
      assert.equal(policy.hosts.pi.fallbackSkillCount, 4);
    });
  });
});

void test("recommendation policy rejects host overrides that declare the wrong host", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      await writePolicyJson(
        projectRoot,
        join("overrides", "hosts", "copilot-vscode.json"),
        {
          schemaVersion: 1,
          host: "cursor",
          policy: {
            recommendationLimit: 12,
          },
        },
      );

      await assert.rejects(
        () => loadRecommendationPolicy(projectRoot),
        /declares host cursor instead of copilot-vscode/u,
      );
    });
  });
});

void test("recommendation policy rejects mismatched user host override schemas", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      await writePolicyJson(
        projectRoot,
        join("overrides", "hosts", "copilot-vscode.json"),
        {
          schemaVersion: 999,
          host: "copilot-vscode",
          policy: {
            recommendationLimit: 12,
          },
        },
      );

      await assert.rejects(
        () => loadRecommendationPolicy(projectRoot),
        /Recommendation policy schema mismatch for copilot-vscode: expected 1, received 999/u,
      );
    });
  });
});

void test("recommendation policy rejects missing preset catalogs referenced by host overrides", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withEmptyPolicyWorkspace(async (projectRoot) => {
      await writeMinimalBasePolicy(projectRoot);
      await writePolicyJson(
        projectRoot,
        join("hosts", "copilot-vscode.json"),
        minimalHostOverride({
          presetRefs: {
            targetAssetKinds: ["frontend-defaults"],
          },
        }),
      );

      await assert.rejects(
        () => loadRecommendationPolicy(projectRoot),
        /references targetAssetKinds presets, but no targetAssetKinds presets are defined/u,
      );

      await writePolicyJson(
        projectRoot,
        join("hosts", "copilot-vscode.json"),
        minimalHostOverride({
          presetRefs: {
            targetConcerns: ["delivery-core"],
          },
        }),
      );

      await assert.rejects(
        () => loadRecommendationPolicy(projectRoot),
        /references targetConcerns presets, but no targetConcerns presets are defined/u,
      );
    });
  });
});

void test("recommendation policy handles policies without preset catalogs or refs", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withEmptyPolicyWorkspace(async (projectRoot) => {
      await writeMinimalBasePolicy(projectRoot);

      const policy = await loadRecommendationPolicy(projectRoot);

      assert.equal(policy.hosts["copilot-vscode"].recommendationLimit, 12);
      assert.deepEqual(policy.hosts["copilot-vscode"].targetAssetKinds, []);
      assert.deepEqual(policy.hosts["copilot-vscode"].targetConcerns, []);
    });
  });
});

void test("recommendation policy rejects missing preset names referenced by host overrides", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      const basePolicy = await loadRecommendationPolicy(projectRoot);
      await writePolicyJson(projectRoot, "base.json", {
        schemaVersion: 1,
        scoring: basePolicy.scoring,
        hostDefaults: {
          recommendationLimit: 12,
          activationBudget: 100,
          suggestedBundleId: "default-bundle",
          maxPerSourceFamily: 4,
          maxPerDuplicateGroup: 2,
          maxPerAssetKind: {},
          targetAssetKinds: [],
          targetConcerns: [],
          suppressedAssetIdPatterns: [],
          suppressedCapabilityTerms: [],
        },
        presets: {
          targetAssetKinds: {
            existing: [{ assetKind: "skill", minimum: 1, weight: 9 }],
          },
          targetConcerns: {
            existing: [{ concern: "backend", minimum: 1, weight: 7 }],
            "delivery-core": [{ concern: "backend", minimum: 1, weight: 6 }],
            "shared-runtime": [{ concern: "runtime", minimum: 1, weight: 5 }],
          },
        },
        concernKeywordMap: {},
        taskModeKeywordMap: {},
        domainKeywordGroups: {},
        synonyms: {},
      });

      await writePolicyJson(projectRoot, join("hosts", "copilot-vscode.json"), {
        schemaVersion: 1,
        host: "copilot-vscode",
        presetRefs: {
          targetAssetKinds: ["missing-asset-kind-preset"],
        },
        policy: {
          recommendationLimit: 12,
          activationBudget: 100,
          suggestedBundleId: "vscode-bundle",
          maxPerSourceFamily: 4,
          maxPerDuplicateGroup: 2,
          maxPerAssetKind: {},
          targetAssetKinds: [],
          targetConcerns: [],
          suppressedAssetIdPatterns: [],
          suppressedCapabilityTerms: [],
        },
      });

      await assert.rejects(
        () => loadRecommendationPolicy(projectRoot),
        /references missing targetAssetKinds preset missing-asset-kind-preset/u,
      );

      await writePolicyJson(projectRoot, join("hosts", "copilot-vscode.json"), {
        schemaVersion: 1,
        host: "copilot-vscode",
        presetRefs: {
          targetConcerns: ["missing-concern-preset"],
        },
        policy: {
          recommendationLimit: 12,
          activationBudget: 100,
          suggestedBundleId: "vscode-bundle",
          maxPerSourceFamily: 4,
          maxPerDuplicateGroup: 2,
          maxPerAssetKind: {},
          targetAssetKinds: [],
          targetConcerns: [],
          suppressedAssetIdPatterns: [],
          suppressedCapabilityTerms: [],
        },
      });

      await assert.rejects(
        () => loadRecommendationPolicy(projectRoot),
        /references missing targetConcerns preset missing-concern-preset/u,
      );
    });
  });
});

void test("recommend policy:print renders the full effective policy when no host is requested", async (t) => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      const output: string[] = [];
      t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
        output.push(args.map((value) => String(value)).join(" "));
      });

      const exitCode = await runRecommend(
        ["policy:print", "--compact"],
        projectRoot,
        projectRoot,
      );

      assert.equal(exitCode, 0);
      const printedPolicy = JSON.parse(
        output.join("\n"),
      ) as RecommendationPolicy;
      assert.equal(printedPolicy.schemaVersion, 1);
      assert.ok(printedPolicy.hosts["copilot-vscode"]);
      assert.ok(printedPolicy.concernKeywordMap);
    });
  });
});

void test("recommend policy:print rejects invalid requested hosts", async () => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      await assert.rejects(
        () =>
          runRecommend(
            ["policy:print", "--host", "definitely-not-a-host"],
            projectRoot,
            projectRoot,
          ),
        /recommend policy:print requires --host to be one of/u,
      );
    });
  });
});

void test("recommend policy:print shows the effective policy with user overrides", async (t) => {
  await withClearedRecommendationLimitEnv(async () => {
    await withPolicyWorkspace(async (projectRoot) => {
      await writePolicyJson(
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

      await writePolicyJson(
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

async function withEmptyPolicyWorkspace(
  callback: (projectRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-policy-empty-"));
  const projectRoot = join(tempRoot, "workspace");

  try {
    await mkdir(join(projectRoot, "discover"), { recursive: true });
    await callback(projectRoot);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function writeMinimalBasePolicy(projectRoot: string): Promise<void> {
  const basePolicy = await loadRecommendationPolicy(repositoryRoot);
  await writePolicyJson(projectRoot, "base.json", {
    schemaVersion: 1,
    scoring: basePolicy.scoring,
    concernKeywordMap: {},
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  });
}

function minimalHostOverride(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    host: "copilot-vscode",
    policy: {
      recommendationLimit: 12,
      activationBudget: 100,
      suggestedBundleId: "vscode-bundle",
      maxPerSourceFamily: 4,
      maxPerDuplicateGroup: 2,
      maxPerAssetKind: {},
      targetAssetKinds: [],
      targetConcerns: [],
      suppressedAssetIdPatterns: [],
      suppressedCapabilityTerms: [],
    },
    ...overrides,
  };
}

async function writePolicyJson(
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
