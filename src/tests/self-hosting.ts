import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { repositoryRoot, runBuiltCli } from "./built-cli-harness.js";

const SELF_HOSTING_TIMEOUT_MS = 300_000;

interface SelfHostingDemandProfile {
  signals?: {
    concerns?: string[];
    frameworks?: string[];
    languages?: string[];
    tooling?: string[];
  };
}

interface SelfHostingSelectionReport {
  inputCount?: number;
  selectedCount?: number;
}

interface SelfHostingRecommendationReport {
  topByHost?: Record<string, unknown[]>;
}

void test("agent-harness can analyze itself as a workspace target", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-self-host-"));
  const stateRoot = join(tempRoot, "state");

  try {
    await runBuiltCli({
      cwd: repositoryRoot,
      env: process.env,
      stateRoot,
      timeout: SELF_HOSTING_TIMEOUT_MS,
      args: ["discover", "demand-profile"],
    });
    await runBuiltCli({
      cwd: repositoryRoot,
      env: process.env,
      stateRoot,
      timeout: SELF_HOSTING_TIMEOUT_MS,
      args: ["discover", "sources"],
    });
    await runBuiltCli({
      cwd: repositoryRoot,
      env: process.env,
      stateRoot,
      timeout: SELF_HOSTING_TIMEOUT_MS,
      args: ["discover", "catalog"],
    });
    await runBuiltCli({
      cwd: repositoryRoot,
      env: process.env,
      stateRoot,
      timeout: SELF_HOSTING_TIMEOUT_MS,
      args: ["discover", "select"],
    });
    await runBuiltCli({
      cwd: repositoryRoot,
      env: process.env,
      stateRoot,
      timeout: SELF_HOSTING_TIMEOUT_MS,
      args: ["discover", "stats"],
    });
    await runBuiltCli({
      cwd: repositoryRoot,
      env: process.env,
      stateRoot,
      timeout: SELF_HOSTING_TIMEOUT_MS,
      args: ["recommend", "report"],
    });
    const { stdout: policyStdout } = await runBuiltCli({
      cwd: repositoryRoot,
      env: process.env,
      stateRoot,
      timeout: SELF_HOSTING_TIMEOUT_MS,
      args: ["recommend", "policy:print", "--host", "vscode"],
    });

    const demandProfile = JSON.parse(
      await readFile(
        join(stateRoot, "discover", "output", "demand-profile.json"),
        "utf8",
      ),
    ) as SelfHostingDemandProfile;
    const sourceIndex = JSON.parse(
      await readFile(
        join(stateRoot, "discover", "output", "source-index.json"),
        "utf8",
      ),
    ) as {
      enabledSources?: unknown[];
      sourceCount?: number;
    };
    const selectionReport = JSON.parse(
      await readFile(
        join(stateRoot, "discover", "output", "selection-report.json"),
        "utf8",
      ),
    ) as SelfHostingSelectionReport;
    const recommendationReport = JSON.parse(
      await readFile(join(stateRoot, "state", "recommendations.json"), "utf8"),
    ) as SelfHostingRecommendationReport;

    assert.ok(demandProfile.signals?.languages?.includes("typescript"));
    assert.ok(demandProfile.signals?.languages?.includes("javascript"));
    assert.ok(
      demandProfile.signals?.concerns?.some((concern) =>
        ["documentation", "devops", "security", "integration"].includes(
          concern,
        ),
      ),
    );
    assert.ok(
      demandProfile.signals?.tooling?.includes("node") ||
        demandProfile.signals?.tooling?.some((tool) => tool.startsWith("npm:")),
    );

    assert.equal(typeof sourceIndex.sourceCount, "number");
    assert.ok((sourceIndex.sourceCount ?? 0) > 0);
    assert.ok(Array.isArray(sourceIndex.enabledSources));
    assert.ok((sourceIndex.enabledSources?.length ?? 0) > 0);

    assert.equal(typeof selectionReport.inputCount, "number");
    assert.ok((selectionReport.inputCount ?? 0) > 0);
    assert.equal(typeof selectionReport.selectedCount, "number");
    assert.ok((selectionReport.selectedCount ?? 0) > 0);

    assert.ok(recommendationReport.topByHost);
    assert.ok(Object.keys(recommendationReport.topByHost ?? {}).length > 0);
    assert.ok(
      Object.values(recommendationReport.topByHost ?? {}).some(
        (entries) => entries.length > 0,
      ),
    );
    assert.match(policyStdout, /recommendationLimit/u);
    assert.match(policyStdout, /activationBudget/u);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
