import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { harvestOfficialSkillIndexes } from "../domains/discovery/official-index-harvester.js";

void test("official index repo extraction respects checked-in owner allowlist", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  try {
    await mkdir(join(projectRoot, "discover"), { recursive: true });
    await writeFile(
      join(projectRoot, "discover", "official-skills-indexes.json"),
      JSON.stringify({
        schemaVersion: 1,
        indexes: [
          {
            id: "fixture",
            kind: "raw",
            url: "https://raw.githubusercontent.com/example/index/main/README.md",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "discover", "official-upstreams.json"),
      JSON.stringify({ schemaVersion: 1, owners: { trusted: ["trusted"] } }),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "discover", "sources.json"),
      JSON.stringify({ schemaVersion: 1, sources: [] }),
      "utf8",
    );

    globalThis.fetch = async () =>
      new Response(
        [
          "**[Trusted Skill](https://officialskills.sh/trusted/skills/safe-skill)** - Safe skill",
          "",
          "# Trusted Skill",
          "https://github.com/evil/safe-skill",
        ].join("\n"),
        { status: 200 },
      );
    context.after(() => {
      globalThis.fetch = originalFetch;
      restoreFetchMockFlag(previousFetchMockFlag);
    });

    const entries = await harvestOfficialSkillIndexes(projectRoot, null, {
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

    assert.equal(entries.length, 1);
    assert.equal(
      entries[0]?.evidence.rootPath,
      "https://officialskills.sh/trusted/skills/safe-skill",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }

  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousValue;
}
