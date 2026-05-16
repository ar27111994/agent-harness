import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { assertRecommendationReport } from "../manifest-validation.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";
import {
  buildRecommendationReport,
  writeRecommendationReport,
} from "../recommend/report.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

void test("recommendation reports apply validated session intent to ranking", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const entries = [
    createEntry("frontend-skill", ["frontend", "ui", "react"]),
    createEntry("backend-skill", ["backend", "api", "service"]),
  ];

  const frontendReport = buildRecommendationReport(
    entries,
    demandProfile,
    policy,
    "frontend",
  );
  const backendReport = buildRecommendationReport(
    entries,
    demandProfile,
    policy,
    "backend",
  );

  assert.equal(frontendReport.sessionIntent, "frontend");
  assert.equal(backendReport.sessionIntent, "backend");
  assert.equal(
    frontendReport.topByHost["copilot-vscode"][0]?.assetId,
    "frontend-skill",
  );
  assert.equal(
    backendReport.topByHost["copilot-vscode"][0]?.assetId,
    "backend-skill",
  );
});

void test("recommendation report validation defaults missing session intent to general", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const report = buildRecommendationReport(
    [createEntry("frontend-skill", ["frontend", "ui", "react"])],
    demandProfile,
    policy,
    "frontend",
  ) as unknown as Record<string, unknown>;

  // assertRecommendationReport mutates the report to apply backward-compatible
  // defaults like sessionIntent="general" for older persisted artifacts.
  delete report.sessionIntent;
  assertRecommendationReport(report, "report");

  assert.equal(report.sessionIntent, "general");
});

void test("recommendation report validation backfills legacy host summary override metadata", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const report = buildRecommendationReport(
    [createEntry("frontend-skill", ["frontend", "ui", "react"])],
    demandProfile,
    policy,
    "frontend",
  ) as unknown as {
    hostSummaries: Record<string, Record<string, unknown>>;
  };

  delete report.hostSummaries["copilot-vscode"].recommendationLimitOverrideMode;
  delete report.hostSummaries["copilot-vscode"]
    .recommendationLimitOverrideModeSource;

  assertRecommendationReport(report, "report");

  assert.equal(
    report.hostSummaries["copilot-vscode"].recommendationLimitOverrideMode,
    "preserve",
  );
  assert.equal(
    report.hostSummaries["copilot-vscode"]
      .recommendationLimitOverrideModeSource,
    "policy",
  );
});

void test("recommendation reports support multiple intents and merge them additively", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const entries = [
    createEntry("frontend-skill", ["frontend", "ui", "react"]),
    createEntry("backend-skill", ["backend", "api", "service"]),
    createEntry("docs-skill", ["documentation", "guide", "readme"]),
  ];

  const multiReport = buildRecommendationReport(
    entries,
    demandProfile,
    policy,
    ["backend", "docs"],
  );

  assert.equal(multiReport.sessionIntent, "backend");
  assert.deepEqual(multiReport.sessionIntents, ["backend", "docs"]);
  const copilotEntries = multiReport.topByHost["copilot-vscode"];
  const ids = copilotEntries.map((e) => e.assetId);
  assert.ok(
    ids.includes("backend-skill"),
    `expected backend-skill in results but got: ${ids.join(", ")}`,
  );
  assert.ok(
    ids.includes("docs-skill"),
    `expected docs-skill in results but got: ${ids.join(", ")}`,
  );
});

void test("recommendation report validation rejects malformed sessionIntents", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const report = buildRecommendationReport(
    [createEntry("backend-skill", ["backend", "api"])],
    demandProfile,
    policy,
    ["backend", "docs"],
  ) as unknown as Record<string, unknown>;

  report.sessionIntents = ["docs", "backend"];
  assert.throws(
    () => assertRecommendationReport(report, "report"),
    /must match sessionIntent/u,
  );

  report.sessionIntents = ["backend"];
  assert.throws(
    () => assertRecommendationReport(report, "report"),
    /must contain at least two intents/u,
  );
});

void test("recommendation reports with one intent omit sessionIntents from output", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const entries = [createEntry("backend-skill", ["backend", "api"])];

  const report = buildRecommendationReport(entries, demandProfile, policy, [
    "backend",
  ]);

  assert.equal(report.sessionIntent, "backend");
  assert.equal(report.sessionIntents, undefined);
});

void test("recommendation reports normalize empty intent arrays to general", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const entries = [createEntry("backend-skill", ["backend", "api"])];

  const report = buildRecommendationReport(entries, demandProfile, policy, []);

  assert.equal(report.sessionIntent, "general");
  assert.equal(report.sessionIntents, undefined);
  assert.ok(report.topByHost["copilot-vscode"].length > 0);
});

void test("recommendation reports default omitted intents to general", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());

  const report = buildRecommendationReport(
    [createEntry("backend-skill", ["backend", "api"])],
    createDemandProfile(),
    policy,
  );

  assert.equal(report.sessionIntent, "general");
  assert.equal(report.sessionIntents, undefined);
});

void test("recommendation reports rank entries for expanded session intent families", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const entries = [
    createEntry("devops-skill", ["devops", "ci-cd", "kubernetes"]),
    createEntry("product-skill", ["business-analysis", "planning", "roadmap"]),
    createEntry("marketing-skill", ["marketing", "seo", "content-marketing"]),
    createEntry("design-skill", ["design-assets", "branding", "penpot"]),
    createEntry("data-skill", ["analytics", "sql", "reporting"]),
    createEntry("mobile-skill", ["mobile", "flutter", "ios"]),
  ];

  assert.equal(
    buildRecommendationReport(entries, demandProfile, policy, "devops")
      .topByHost["copilot-vscode"][0]?.assetId,
    "devops-skill",
  );
  assert.equal(
    buildRecommendationReport(entries, demandProfile, policy, "product")
      .topByHost["copilot-vscode"][0]?.assetId,
    "product-skill",
  );
  assert.equal(
    buildRecommendationReport(entries, demandProfile, policy, "marketing")
      .topByHost["copilot-vscode"][0]?.assetId,
    "marketing-skill",
  );
  assert.equal(
    buildRecommendationReport(entries, demandProfile, policy, "design")
      .topByHost["copilot-vscode"][0]?.assetId,
    "design-skill",
  );
  assert.equal(
    buildRecommendationReport(entries, demandProfile, policy, "data").topByHost[
      "copilot-vscode"
    ][0]?.assetId,
    "data-skill",
  );
  assert.equal(
    buildRecommendationReport(entries, demandProfile, policy, "mobile")
      .topByHost["copilot-vscode"][0]?.assetId,
    "mobile-skill",
  );
});

void test(
  "recommendation reports handle large candidate sets without stalling",
  { timeout: 15_000 },
  async () => {
    clearRuntimeConfigForTests();
    const policy = await loadRecommendationPolicy(process.cwd());
    const demandProfile = createDemandProfile();
    const entries = Array.from({ length: 2_000 }, (_, index) =>
      createEntry(
        `fixture-skill-${index}`,
        index % 2 === 0
          ? ["backend", "api", `service-${index}`]
          : ["docs", "guide", `reference-${index}`],
      ),
    );

    const report = buildRecommendationReport(entries, demandProfile, policy, [
      "backend",
      "docs",
    ]);

    assert.equal(report.sessionIntent, "backend");
    assert.deepEqual(report.sessionIntents, ["backend", "docs"]);
    assert.ok(report.topByHost["copilot-vscode"].length > 0);
    assert.ok(report.topByHost["shared"].length > 0);
  },
);

void test("recommendation reports expose env-sourced recommendation limits", async () => {
  clearRuntimeConfigForTests();
  const previousEnvValue =
    process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
  const previousModeEnvValue =
    process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE;
  process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT = "7";
  delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE;

  try {
    const policy = await loadRecommendationPolicy(process.cwd());
    const report = buildRecommendationReport(
      [createEntry("frontend-skill", ["frontend", "ui", "react"])],
      createDemandProfile(),
      policy,
      "frontend",
    );

    assert.equal(policy.hosts["copilot-vscode"].recommendationLimit, 7);
    assert.equal(report.hostSummaries["copilot-vscode"].recommendationLimit, 7);
    assert.equal(
      report.hostSummaries["copilot-vscode"].recommendationLimitSource,
      "env",
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"].recommendationLimitEnvVar,
      "AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT",
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"].recommendationLimitOverrideMode,
      "preserve",
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"]
        .recommendationLimitOverrideModeSource,
      "policy",
    );
  } finally {
    if (previousEnvValue === undefined) {
      delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
    } else {
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT =
        previousEnvValue;
    }
    if (previousModeEnvValue === undefined) {
      delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE;
    } else {
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE =
        previousModeEnvValue;
    }
    clearRuntimeConfigForTests();
  }
});

void test("recommendation reports expose explicit scale-mode metadata", async () => {
  clearRuntimeConfigForTests();
  const previousLimitEnvValue =
    process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
  const previousModeEnvValue =
    process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE;
  process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT = "120";
  process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE = "scale";

  try {
    const policy = await loadRecommendationPolicy(process.cwd());
    const report = buildRecommendationReport(
      [createEntry("frontend-skill", ["frontend", "ui", "react"])],
      createDemandProfile(),
      policy,
      "frontend",
    );

    assert.equal(policy.hosts["copilot-vscode"].recommendationLimit, 120);
    assert.equal(policy.hosts["copilot-vscode"].maxPerAssetKind.skill, 36);
    assert.equal(
      policy.hosts["copilot-vscode"].targetAssetKinds.find(
        (entry) => entry.assetKind === "skill",
      )?.minimum,
      12,
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"].recommendationLimitOverrideMode,
      "scale",
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"]
        .recommendationLimitOverrideModeSource,
      "env",
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"]
        .recommendationLimitOverrideModeEnvVar,
      "AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE",
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"].recommendationLimitScaleFactor,
      0.5,
    );
    assert.ok(
      report.hostSummaries[
        "copilot-vscode"
      ].recommendationLimitScaledFields?.includes("maxPerAssetKind.skill"),
    );
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
});

void test("writeRecommendationReport loads policy when omitted and tolerates missing demand profile", async () => {
  clearRuntimeConfigForTests();
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-report-policy-load-"),
  );

  try {
    await mkdir(join(projectRoot, "discover", "output"), { recursive: true });
    await mkdir(join(projectRoot, "discover", "recommendation-policy"), {
      recursive: true,
    });
    await writeFile(
      join(projectRoot, "discover", "recommendation-policy", "base.json"),
      await (
        await import("node:fs/promises")
      ).readFile(
        join(process.cwd(), "discover", "recommendation-policy", "base.json"),
        "utf8",
      ),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      `${JSON.stringify(createEntry("backend-skill", ["backend", "api"]))}\n`,
      "utf8",
    );

    const report = await writeRecommendationReport(projectRoot);

    assert.equal(report.sessionIntent, "general");
    assert.equal(report.sessionIntents, undefined);
    assert.ok(report.topByHost["copilot-vscode"].length > 0);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("writeRecommendationReport defaults omitted session intents to general", async () => {
  clearRuntimeConfigForTests();
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-report-defaults-"),
  );

  try {
    await mkdir(join(projectRoot, "discover", "output"), { recursive: true });
    await writeFile(
      join(projectRoot, "discover", "output", "demand-profile.json"),
      `${JSON.stringify(createDemandProfile(), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      `${JSON.stringify(createEntry("backend-skill", ["backend", "api"]))}\n`,
      "utf8",
    );

    const report = await writeRecommendationReport(projectRoot, {
      policy: await loadRecommendationPolicy(process.cwd()),
    });

    assert.equal(report.sessionIntent, "general");
    assert.equal(report.sessionIntents, undefined);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("writeRecommendationReport persists built report from selected catalog artifacts", async () => {
  clearRuntimeConfigForTests();
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-report-write-"),
  );

  try {
    await mkdir(join(projectRoot, "discover", "output"), { recursive: true });
    await writeFile(
      join(projectRoot, "discover", "output", "demand-profile.json"),
      `${JSON.stringify(createDemandProfile(), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      `${[
        createEntry("backend-skill", ["backend", "api"]),
        {
          ...createEntry("incompatible-skill", ["backend"]),
          compatibilityMode: "incompatible",
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
      "utf8",
    );

    const report = await writeRecommendationReport(projectRoot, {
      policy: await loadRecommendationPolicy(process.cwd()),
      sessionIntents: ["backend", "docs"],
    });

    assert.equal(report.sessionIntent, "backend");
    assert.deepEqual(report.sessionIntents, ["backend", "docs"]);
    assert.ok(
      report.topByHost["copilot-vscode"].every(
        (entry) => entry.assetId !== "incompatible-skill",
      ),
    );

    const persisted = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(projectRoot, "state", "recommendations.json"), "utf8"),
    ) as Record<string, unknown>;
    assertRecommendationReport(persisted, "report");
    assert.equal(persisted.sessionIntent, "backend");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

function createDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 8,
      matchedFiles: 3,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: [],
      concerns: [],
      tooling: ["eslint"],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: [],
          tooling: ["eslint"],
        },
      },
    ],
  };
}

function createEntry(id: string, capabilities: string[]): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode", "opencode", "shared"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 80,
      originUrl: `https://example.com/${id}`,
      publisher: "fixture-source",
      publisherVerified: false,
    },
    trust: {
      score: 80,
      signals: ["fixture"],
    },
    capabilities,
    install: {
      method: "fixture",
      nativeHosts: ["copilot-vscode", "opencode", "shared"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: "active",
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
      hostFit: 0.9,
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
  };
}
