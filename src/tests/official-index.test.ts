import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { harvestOfficialSkillIndexes } from "../domains/discovery/official-index-harvester.js";
import {
  fetchOfficialIndexPageContent,
  fetchOfficialIndexPageInfo,
  fetchOfficialIndexPageRepositoryUrl,
  officialIndexInternals,
} from "../official-index.js";

void test("official index page content does not double-decode escaped entities", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  try {
    globalThis.fetch = async () =>
      new Response(
        [
          "<html><head>",
          "<title>Cloudflare/cloudflare — Agent Skills | officialskills.sh</title>",
          '<meta name="description" content="Keeps &amp;quot;quoted&amp;quot; guidance intact." />',
          "</head><body>",
          "<section><h2>What This Skill Does</h2><p>Preserves &amp;quot;quoted&amp;quot; examples.</p></section>",
          "npx skills add https://github.com/cloudflare/skills --skill cloudflare",
          "</body></html>",
        ].join(""),
        { status: 200 },
      );
    context.after(() => {
      globalThis.fetch = originalFetch;
      restoreFetchMockFlag(previousFetchMockFlag);
    });

    const content = await fetchOfficialIndexPageContent(
      "https://officialskills.sh/cloudflare/skills/cloudflare",
    );

    assert.match(content ?? "", /&quot;quoted&quot;/u);
    assert.doesNotMatch(content ?? "", /"quoted"/u);
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  }
});

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

    const entries = await harvestOfficialSkillIndexes(projectRoot, null);

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

void test("official index info extracts fallback sections and normalizes repository urls", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () =>
    new Response(
      [
        "<html><head>",
        "<title>Example Skill — Agent Skills | officialskills.sh</title>",
        '<meta name="description" content="Ships workflow helpers." />',
        "</head><body>",
        "<section><h2>What This Skill Does</h2><p>Primary summary.</p><p>Secondary why-it-helps paragraph.</p></section>",
        "<section><h2>When to use it</h2><ul><li>First use case</li><li>Second use case</li></ul></section>",
        '<a href="https://github.com/example/skill-repo/blob/main/README.md">View on GitHub</a>',
        "npx skills add https://github.com/example/skill-repo.git --skill example-skill",
        "</body></html>",
      ].join(""),
      { status: 200 },
    );

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const info = await fetchOfficialIndexPageInfo(
    "https://officialskills.sh/example/skills/example-skill",
  );

  assert.equal(info.repositoryUrl, "https://github.com/example/skill-repo");
  assert.match(
    info.content ?? "",
    /## Why It Helps\nSecondary why-it-helps paragraph\./u,
  );
  assert.match(info.content ?? "", /- First use case/u);
  assert.match(
    info.content ?? "",
    /```bash\nnpx skills add https:\/\/github\.com\/example\/skill-repo\.git --skill example-skill/u,
  );
});

void test("official index summary helpers cover fallback and empty branches", () => {
  assert.deepEqual(
    officialIndexInternals.buildKeyPoints({
      description: null,
      installCommand: null,
      githubUrl: null,
      useCases: [],
    }),
    ["- Official index entry mirrored as structured summary."],
  );
  assert.equal(
    officialIndexInternals.extractGitHubUrl(
      '<a href="https://github.com/example/from-link">View on GitHub</a>',
      null,
    ),
    "https://github.com/example/from-link",
  );
  assert.equal(
    officialIndexInternals.extractGitHubUrl(
      "https://github.com/example/from-plain",
      null,
    ),
    "https://github.com/example/from-plain",
  );
  assert.equal(
    officialIndexInternals.extractSectionContent(
      "Special (A+B)",
      "<h3>Special (A+B)</h3><p>Fallback</p><h2>Next</h2>",
    ),
    "<p>Fallback</p>",
  );
  assert.equal(
    officialIndexInternals.normalizeGitHubRepositoryUrl("https://github.com"),
    null,
  );
  assert.equal(
    officialIndexInternals.normalizeGitHubRepositoryUrl("not a url"),
    null,
  );
  assert.match(
    officialIndexInternals.extractOfficialIndexPageSummary(
      "<html></html>",
      "https://officialskills.sh/empty",
    ),
    /No concise summary was available/u,
  );
});

void test("official index repository url helper rejects non-github links and empty content", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  let responseIndex = 0;
  globalThis.fetch = async () => {
    responseIndex += 1;
    if (responseIndex === 1) {
      return new Response(
        [
          "<html><body>",
          "<section><h3>What This Skill Does</h3><p>Fallback heading summary.</p></section>",
          "https://gitlab.com/example/project",
          "</body></html>",
        ].join(""),
        { status: 200 },
      );
    }

    return new Response("", { status: 404 });
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const repositoryUrl = await fetchOfficialIndexPageRepositoryUrl(
    "https://officialskills.sh/example/skills/fallback",
  );
  const content = await fetchOfficialIndexPageContent(
    "https://officialskills.sh/example/skills/missing",
  );

  assert.equal(repositoryUrl, null);
  assert.equal(content, null);
});

void test("official index content falls back to meta description when the summary section has no paragraph", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () =>
    new Response(
      [
        "<html><head>",
        "<title>No Paragraph Skill - Agent Skills | officialskills.sh</title>",
        '<meta name="description" content="Description becomes the core concept." />',
        "</head><body>",
        "<section><h2>What This Skill Does</h2><ul><li>No paragraph here.</li></ul></section>",
        "</body></html>",
      ].join(""),
      { status: 200 },
    );

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const content = await fetchOfficialIndexPageContent(
    "https://officialskills.sh/example/skills/no-paragraph",
  );

  assert.match(
    content ?? "",
    /## Core Concept\nDescription becomes the core concept\./u,
  );
  assert.doesNotMatch(content ?? "", /No paragraph here/u);
});

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }

  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousValue;
}
