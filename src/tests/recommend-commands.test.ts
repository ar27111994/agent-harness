import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { runRecommend } from "../recommend/commands.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  RecommendationAiReviewArtifact,
  RecommendationEntry,
  RecommendationEvaluationResult,
  RecommendationHostSummary,
  RecommendationReport,
} from "../types.js";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

void test("recommend explain prints detailed entry diagnostics for a host", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-explain-"),
  );
  await seedRecommendationReport(projectRoot, createRecommendationReport());
  t.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  const exitCode = await runRecommend(
    ["explain", "--asset", "asset-a", "--host", "vscode"],
    projectRoot,
    projectRoot,
  );

  assert.equal(exitCode, 0);
  const rendered = output.join("\n");
  assert.match(rendered, /Host: vscode/u);
  assert.match(
    rendered,
    /matched signals: frameworks:apify\(w=6,e=2,ew=3,s=1\/m=1\/w=0\)/u,
  );
  assert.match(rendered, /breakdown: authority=10, compatibility=9/u);
  assert.match(rendered, /coverage: backend, testing/u);
  assert.match(rendered, /task modes: implementation, validation/u);
});

void test("recommend explain reports missing assets and unknown commands print help", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-missing-"),
  );
  await seedRecommendationReport(projectRoot, createRecommendationReport());
  t.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  const explainExitCode = await runRecommend(
    ["explain", "--asset", "does-not-exist"],
    projectRoot,
    projectRoot,
  );
  const originalStdoutWrite = process.stdout.write;
  let helpOutput = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    helpOutput += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  const helpExitCode = await runRecommend(
    ["unknown-command"],
    projectRoot,
    projectRoot,
  );
  process.stdout.write = originalStdoutWrite;

  assert.equal(explainExitCode, 0);
  assert.equal(helpExitCode, 1);
  assert.match(
    output[0] ?? "",
    /not present in the current recommendation report/u,
  );
  assert.match(helpOutput, /recommend commands:/u);
});

void test("recommend explain rejects invalid host values", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-invalid-host-"),
  );
  await seedRecommendationReport(projectRoot, createRecommendationReport());

  try {
    await assert.rejects(
      () =>
        runRecommend(
          ["explain", "--asset", "asset-a", "--host", "not-a-host"],
          projectRoot,
          projectRoot,
        ),
      /Invalid --host value: not-a-host/u,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("recommend explain requires an asset id", async () => {
  await assert.rejects(
    () => runRecommend(["explain"], process.cwd(), process.cwd()),
    /recommend explain requires --asset <assetId>/u,
  );
});

void test("recommend explain renders empty coverage and signal sections as none", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-none-"),
  );
  const report = createRecommendationReport();
  const entry = report.topByHost["copilot-vscode"][1];
  if (!entry) {
    throw new Error("expected fixture entry for asset-b");
  }
  entry.coverageTags = [];
  entry.taskModes = [];
  entry.matchedSignals = [];
  await seedRecommendationReport(projectRoot, report);
  t.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  const exitCode = await runRecommend(
    ["explain", "--asset", "asset-b", "--host", "vscode"],
    projectRoot,
    projectRoot,
  );

  assert.equal(exitCode, 0);
  const rendered = output.join("\n");
  assert.match(rendered, /coverage: none/u);
  assert.match(rendered, /task modes: none/u);
  assert.match(rendered, /matched signals: none/u);
});

void test("recommend help command prints help and succeeds", async () => {
  const originalStdoutWrite = process.stdout.write;
  let helpOutput = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    helpOutput += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    const exitCode = await runRecommend(["help"], process.cwd(), process.cwd());

    assert.equal(exitCode, 0);
    assert.match(helpOutput, /recommend commands:/u);
    assert.match(helpOutput, /AI review options:/u);
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
});

void test("recommend evaluate writes evaluation artifacts for the copied policy workspace", async () => {
  await withRecommendationWorkspace(async (projectRoot) => {
    const output: string[] = [];
    const originalConsoleLog = globalThis.console.log;
    globalThis.console.log = (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    };

    try {
      const exitCode = await runRecommend(
        ["evaluate", "--write"],
        projectRoot,
        projectRoot,
      );

      assert.equal(exitCode, 0);
      assert.match(output.join("\n"), /Summary:/u);
      const persisted = JSON.parse(
        await readFile(
          join(projectRoot, "state", "recommendation-evaluation.json"),
          "utf8",
        ),
      ) as RecommendationEvaluationResult;
      assert.ok(persisted.fixtures.length > 0);
      assert.ok(persisted.summary.fixtureCount > 0);
    } finally {
      globalThis.console.log = originalConsoleLog;
    }
  });
});

void test("recommend report supports merged intents and disabled ai review", async () => {
  await withDisabledAiReviewEnv(async () => {
    await withRecommendationWorkspace(async (projectRoot) => {
      await seedRecommendationInputs(projectRoot);

      const output: string[] = [];
      const originalConsoleLog = globalThis.console.log;
      globalThis.console.log = (...args: unknown[]) => {
        output.push(args.map((value) => String(value)).join(" "));
      };

      try {
        const exitCode = await runRecommend(
          [
            "report",
            "--intent",
            "frontend",
            "--intent",
            "backend",
            "--ai-review",
            "--host",
            "vscode",
            "--review-limit",
            "2",
          ],
          projectRoot,
          projectRoot,
        );

        assert.equal(exitCode, 0);
        const report = JSON.parse(
          await readFile(
            join(projectRoot, "state", "recommendations.json"),
            "utf8",
          ),
        ) as RecommendationReport;
        const artifact = JSON.parse(
          await readFile(
            join(projectRoot, "recommend", "output", "ai-review.json"),
            "utf8",
          ),
        ) as RecommendationAiReviewArtifact;

        assert.equal(report.sessionIntent, "frontend");
        assert.deepEqual(report.sessionIntents, ["frontend", "backend"]);
        assert.equal(artifact.status, "disabled");
        assert.match(output.join("\n"), /AI review artifacts written under/u);
      } finally {
        globalThis.console.log = originalConsoleLog;
      }
    });
  });
});

void test("recommend ai-review can apply disabled review artifacts and persist outputs", async () => {
  await withDisabledAiReviewEnv(async () => {
    await withRecommendationWorkspace(async (projectRoot) => {
      await seedRecommendationInputs(projectRoot);

      const output: string[] = [];
      const originalConsoleLog = globalThis.console.log;
      globalThis.console.log = (...args: unknown[]) => {
        output.push(args.map((value) => String(value)).join(" "));
      };

      try {
        const exitCode = await runRecommend(
          ["ai-review", "--apply", "--host", "vscode", "--review-limit", "2"],
          projectRoot,
          projectRoot,
        );

        assert.equal(exitCode, 0);
        const report = JSON.parse(
          await readFile(
            join(projectRoot, "state", "recommendations.json"),
            "utf8",
          ),
        ) as RecommendationReport;
        const artifact = JSON.parse(
          await readFile(
            join(projectRoot, "recommend", "output", "ai-review.json"),
            "utf8",
          ),
        ) as RecommendationAiReviewArtifact;

        assert.equal(artifact.status, "disabled");
        assert.ok(report.topByHost["copilot-vscode"].length > 0);
        assert.match(
          output.join("\n"),
          /Applied AI review adjustments to .*state\\recommendations\.json/u,
        );
      } finally {
        globalThis.console.log = originalConsoleLog;
      }
    });
  });
});

void test("recommend report persists applied ai review adjustments", async (t) => {
  await withRecommendationWorkspace(async (projectRoot) => {
    await seedRecommendationInputs(projectRoot);

    const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
    const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
    const previousOrigins =
      process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
    const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    const originalFetch = globalThis.fetch;
    const output: string[] = [];

    process.env.AGENT_HARNESS_AI_ENRICHMENT_URL =
      "https://example.com/ai-review";
    process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
      "https://example.com";
    process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
    clearRuntimeConfigForTests();

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          hostReviews: [
            {
              host: "copilot-vscode",
              suppressedAssetIds: ["react-playwright-skill"],
            },
          ],
        }),
        { status: 200 },
      );
    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    try {
      const exitCode = await runRecommend(
        ["report", "--intent", "frontend", "--ai-review"],
        projectRoot,
        projectRoot,
      );

      assert.equal(exitCode, 0);
      const report = JSON.parse(
        await readFile(
          join(projectRoot, "state", "recommendations.json"),
          "utf8",
        ),
      ) as RecommendationReport;
      const artifact = JSON.parse(
        await readFile(
          join(projectRoot, "recommend", "output", "ai-review.json"),
          "utf8",
        ),
      ) as RecommendationAiReviewArtifact;

      assert.equal(artifact.status, "completed");
      assert.ok(
        !report.topByHost["copilot-vscode"].some(
          (entry) => entry.assetId === "react-playwright-skill",
        ),
      );
      assert.match(output.join("\n"), /Recommendation report written/u);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
      restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
      restoreEnv(
        "AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS",
        previousOrigins,
      );
      restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
      clearRuntimeConfigForTests();
    }
  });
});

void test("recommend report rejects invalid ai review limits", async () => {
  await withDisabledAiReviewEnv(async () => {
    await withRecommendationWorkspace(async (projectRoot) => {
      await seedRecommendationInputs(projectRoot);

      await assert.rejects(
        () =>
          runRecommend(
            ["report", "--ai-review", "--review-limit", "0"],
            projectRoot,
            projectRoot,
          ),
        /Invalid --review-limit value: 0/u,
      );
    });
  });
});

void test("recommend ai-review rejects invalid host values", async () => {
  await withDisabledAiReviewEnv(async () => {
    await withRecommendationWorkspace(async (projectRoot) => {
      await seedRecommendationInputs(projectRoot);

      await assert.rejects(
        () =>
          runRecommend(
            ["ai-review", "--host", "not-a-host"],
            projectRoot,
            projectRoot,
          ),
        /Invalid --host value: not-a-host/u,
      );
    });
  });
});

async function withDisabledAiReviewEnv(
  callback: () => Promise<void>,
): Promise<void> {
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;

  delete process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  delete process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  clearRuntimeConfigForTests();

  try {
    await callback();
  } finally {
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    clearRuntimeConfigForTests();
  }
}

async function withRecommendationWorkspace(
  callback: (projectRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-recommend-"));
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

async function seedRecommendationInputs(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "discover", "output"), { recursive: true });

  const demandProfile = createDemandProfile();
  const catalogEntries = createCatalogEntries();

  await writeFile(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    `${JSON.stringify(demandProfile, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    `${catalogEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}

async function seedRecommendationReport(
  projectRoot: string,
  report: RecommendationReport,
): Promise<void> {
  await mkdir(join(projectRoot, "state"), { recursive: true });
  await writeFile(
    join(projectRoot, "state", "recommendations.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

function createRecommendationReport(): RecommendationReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: 1,
    sessionIntent: "general",
    topByHost: {
      shared: [],
      "copilot-vscode": [
        createRecommendationEntry("asset-a", 1, 91),
        createRecommendationEntry("asset-b", 2, 80),
      ],
      opencode: [],
      cursor: [],
      zed: [],
      "claude-code": [],
      pi: [],
    },
    hostSummaries: {
      shared: createSummary("shared"),
      "copilot-vscode": createSummary("copilot-vscode"),
      opencode: createSummary("opencode"),
      cursor: createSummary("cursor"),
      zed: createSummary("zed"),
      "claude-code": createSummary("claude-code"),
      pi: createSummary("pi"),
    },
    suggestedBundles: [],
  };
}

function createRecommendationEntry(
  assetId: string,
  rank: number,
  score: number,
): RecommendationEntry {
  return {
    assetId,
    host: "copilot-vscode",
    rank,
    score,
    reasons: ["fit:exact-stack", "coverage-gap-fill"],
    assetKind: "skill",
    sourceId: "fixture-source",
    sourceFamily: "fixture-family",
    availableLocally: false,
    recommendationBasis: "workspace-fit",
    contextSizeClass: "small",
    estimatedPromptWeight: 2,
    selectionStage: "top-by-host",
    coverageTags: ["backend", "testing"],
    taskModes: ["implementation", "validation"],
    matchedSignals: [
      {
        signalType: "frameworks",
        term: "apify",
        weight: 6,
        evidenceCount: 2,
        weightedEvidenceCount: 3,
        evidenceStrengthCounts: {
          strong: 1,
          medium: 1,
          weak: 0,
        },
      },
    ],
    scoreBreakdown: {
      authority: 10,
      compatibility: 9,
      portfolioFit: 8,
      trust: 7,
      sourcePriority: 6,
      demand: 5,
      hostPreference: 4,
      coverage: 3,
      diversity: 2,
      freshness: 1,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: 0,
      redundancyPenalty: 0,
      budgetPenalty: 0,
      total: score,
    },
  };
}

function createSummary(host: string): RecommendationHostSummary {
  return {
    host,
    recommendationLimit: 10,
    recommendationLimitSource: "policy",
    recommendationLimitOverrideMode: "preserve",
    recommendationLimitOverrideModeSource: "policy",
    activationBudget: 20,
    selectedCount: 0,
    totalEstimatedPromptWeight: 0,
    selectedAssetIds: [],
    byAssetKind: {},
    bySourceFamily: {},
    byConcern: {},
    concernBuckets: {},
    taskModeBuckets: {},
  };
}

function createDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["react"],
      concerns: ["frontend", "testing"],
      tooling: ["playwright"],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: ["react"],
          concerns: ["frontend", "testing"],
          tooling: ["playwright"],
        },
      },
    ],
  };
}

function createCatalogEntries(): AssetCatalogEntry[] {
  return [
    {
      id: "react-playwright-skill",
      displayName: "React Playwright Skill",
      assetKind: "skill",
      hosts: ["copilot-vscode"],
      compatibilityMode: "native",
      source: {
        sourceId: "fixture-source",
        sourceKind: "repo",
        authorityTier: "trusted-community",
        sourcePriority: 60,
        originUrl: "https://github.com/example/react-playwright-skill",
        publisher: "fixture-source",
        publisherVerified: false,
      },
      trust: {
        score: 40,
        signals: ["community"],
      },
      capabilities: ["react", "playwright", "frontend", "testing"],
      install: {
        method: "local-file",
        relativePath: "skills/react-playwright-skill.md",
      },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "skills/react-playwright-skill.md",
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 10,
        releaseCadence: "test",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      fit: {
        portfolioFit: 0.9,
        hostFit: 1,
      },
      dedupe: {
        candidateRankHint: "fixture",
      },
      status: {
        cataloged: true,
        mirrorEligible: true,
        installEligible: true,
        activationEligible: true,
      },
    },
    {
      id: "generic-local-toolkit",
      displayName: "Generic Local Toolkit",
      assetKind: "skill",
      hosts: ["copilot-vscode"],
      compatibilityMode: "native",
      source: {
        sourceId: "local-toolkit",
        sourceKind: "local-directory",
        authorityTier: "trusted-local",
        sourcePriority: 40,
        originUrl: "https://example.com/local-toolkit",
        publisher: "local-toolkit",
        publisherVerified: true,
      },
      trust: {
        score: 50,
        signals: ["local"],
      },
      capabilities: ["automation", "workflow", "docs"],
      install: {
        method: "local-file",
        relativePath: "skills/generic-local-toolkit.md",
      },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "skills/generic-local-toolkit.md",
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 1,
        releaseCadence: "test",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
      contextCost: {
        sizeClass: "tiny",
        estimatedPromptWeight: 1,
      },
      fit: {
        portfolioFit: 0.5,
        hostFit: 1,
      },
      dedupe: {
        candidateRankHint: "fixture",
      },
      status: {
        cataloged: true,
        mirrorEligible: true,
        installEligible: true,
        activationEligible: true,
      },
    },
  ];
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
