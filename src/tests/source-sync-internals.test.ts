import assert from "node:assert/strict";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { restoreEnvVar, setHttpTestFetchMocks } from "./env-test-utils.js";
import { buildCatalogId } from "../domains/discovery/catalog-utils.js";
import type { SourceSyncSourceState } from "../domains/discovery/source-sync.js";
import { sourceSyncInternals } from "../domains/discovery/source-sync.js";
import { htmlSyncInternals } from "../domains/discovery/source-sync/html.js";
import type {
  AssetCatalogEntry,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("source sync helper exports compare nested catalog entries independent of object key order", () => {
  const left = buildIndexedEntry("acme.react-tools", ["react", "testing"]);
  const right = {
    status: { ...left.status },
    dedupe: { ...left.dedupe },
    fit: { ...left.fit },
    contextCost: { ...left.contextCost },
    risk: { ...left.risk },
    maintenance: { ...left.maintenance },
    evidence: { ...left.evidence },
    install: { ...left.install },
    capabilities: [...left.capabilities],
    trust: { ...left.trust },
    source: { ...left.source },
    compatibilityMode: left.compatibilityMode,
    hosts: [...left.hosts],
    assetKind: left.assetKind,
    displayName: left.displayName,
    id: left.id,
  } satisfies AssetCatalogEntry;

  assert.equal(
    sourceSyncInternals.areIndexedCatalogEntriesEqual(left, right),
    true,
  );
  assert.deepEqual(
    sourceSyncInternals.sortJsonValue({ b: 2, a: { d: 4, c: 3 } }),
    {
      a: { c: 3, d: 4 },
      b: 2,
    },
  );
  assert.deepEqual(sourceSyncInternals.sortJsonValue([right.source, null, 3]), [
    { ...right.source },
    null,
    3,
  ]);
  assert.equal(
    sourceSyncInternals.stableStringify({ b: 2, a: 1 }),
    JSON.stringify({ a: 1, b: 2 }),
  );
});

void test("source sync helper exports restore legacy cursors and token parsing branches", () => {
  const currentCursors: SourceSyncSourceState = {
    sourceId: "vscode-marketplace",
    coverageMode: "indexed",
    status: "partial",
    indexedEntryCount: 2,
    cursors: [{ cursorId: "react", nextToken: "3", completed: false }],
  };
  const legacyCursors = {
    sourceId: "vscode-marketplace",
    coverageMode: "indexed",
    status: "partial",
    indexedEntryCount: 1,
    cursors: [],
    queries: [{ query: "testing", nextPage: 4, completed: true }],
  } as SourceSyncSourceState & {
    queries: Array<{ query: string; nextPage: number; completed: boolean }>;
  };

  assert.deepEqual(sourceSyncInternals.getPreviousCursorStates(undefined), []);
  assert.deepEqual(
    sourceSyncInternals.getPreviousCursorStates(currentCursors),
    currentCursors.cursors,
  );
  assert.deepEqual(sourceSyncInternals.getPreviousCursorStates(legacyCursors), [
    { cursorId: "testing", nextToken: "4", completed: true },
  ]);
  assert.deepEqual(
    sourceSyncInternals.getPreviousCursorStates({
      ...currentCursors,
      cursors: undefined,
      queries: "not-an-array",
    } as unknown as SourceSyncSourceState & { queries: string }),
    [],
  );

  assert.deepEqual(
    sourceSyncInternals.restoreFiniteCursorState(undefined, {
      cursorId: "react",
      nextToken: "1",
      completed: false,
    }),
    { cursorId: "react", nextToken: "1", completed: false },
  );
  assert.deepEqual(
    sourceSyncInternals.restoreFiniteCursorState(
      { cursorId: "react", nextToken: "7", completed: false },
      { cursorId: "react", nextToken: "1", completed: false },
    ),
    { cursorId: "react", nextToken: "7", completed: false },
  );
  assert.deepEqual(
    sourceSyncInternals.restoreFiniteCursorState(
      { cursorId: "react", completed: false },
      { cursorId: "react", nextToken: "1", completed: false },
    ),
    { cursorId: "react", nextToken: "1", completed: false },
  );
  assert.deepEqual(
    sourceSyncInternals.restoreFiniteCursorState(
      { cursorId: "react", nextToken: "7", completed: true },
      { cursorId: "react", nextToken: "1", completed: false },
    ),
    { cursorId: "react", nextToken: "1", completed: false },
  );

  assert.equal(sourceSyncInternals.parsePositiveIntegerToken("5", 1), 5);
  assert.equal(sourceSyncInternals.parsePositiveIntegerToken("0", 1), 1);
  assert.equal(sourceSyncInternals.parsePositiveIntegerToken("x", 2), 2);
  assert.equal(sourceSyncInternals.parsePositiveIntegerToken(undefined, 2), 2);
  assert.equal(sourceSyncInternals.parseNonNegativeIntegerToken("0", 1), 0);
  assert.equal(sourceSyncInternals.parseNonNegativeIntegerToken("-1", 1), 1);
  assert.equal(
    sourceSyncInternals.parseNonNegativeIntegerToken(undefined, 3),
    3,
  );

  assert.equal(sourceSyncInternals.stringifyUnknown("text"), "text");
  assert.equal(sourceSyncInternals.stringifyUnknown(42), "42");
  assert.equal(sourceSyncInternals.stringifyUnknown(Number.NaN), undefined);
  assert.equal(sourceSyncInternals.getErrorMessage(new Error("boom")), "boom");
  assert.equal(sourceSyncInternals.getErrorMessage(404), "404");

  // allPreviousCursorsCompleted
  assert.equal(
    sourceSyncInternals.allPreviousCursorsCompleted(undefined),
    true,
    "no previous state → treat as fresh scan",
  );
  assert.equal(
    sourceSyncInternals.allPreviousCursorsCompleted({
      sourceId: "x",
      coverageMode: "indexed",
      status: "complete",
      indexedEntryCount: 0,
      cursors: [],
    }),
    true,
    "empty cursors array → treat as fresh scan",
  );
  assert.equal(
    sourceSyncInternals.allPreviousCursorsCompleted({
      sourceId: "x",
      coverageMode: "indexed",
      status: "complete",
      indexedEntryCount: 1,
      cursors: [
        { cursorId: "a", completed: true },
        { cursorId: "b", completed: true },
      ],
    }),
    true,
    "all cursors completed → fresh scan",
  );
  assert.equal(
    sourceSyncInternals.allPreviousCursorsCompleted({
      sourceId: "x",
      coverageMode: "indexed",
      status: "partial",
      indexedEntryCount: 1,
      cursors: [
        { cursorId: "a", completed: true },
        { cursorId: "b", completed: false },
      ],
    }),
    false,
    "any cursor not completed → mid-stream resume",
  );
});

void test("source sync helper exports cover non-indexed classification and path parsing branches", () => {
  const repoState = sourceSyncInternals.classifyNonIndexedSource(
    buildSourceDefinition("github-awesome", "repo"),
    "2026-05-15T00:00:00.000Z",
    true,
  );
  assert.equal(repoState.coverageMode, "rotating");
  assert.equal(repoState.lastSyncedAt, "2026-05-15T00:00:00.000Z");

  const directState = sourceSyncInternals.classifyNonIndexedSource(
    buildSourceDefinition("cursor-docs", "docs"),
    "2026-05-15T00:00:00.000Z",
    false,
  );
  assert.equal(directState.coverageMode, "direct");
  assert.equal(directState.lastSyncedAt, undefined);

  const sampledState = sourceSyncInternals.classifyNonIndexedSource(
    buildSourceDefinition("vscode-marketplace", "registry"),
    "2026-05-15T00:00:00.000Z",
    false,
  );
  assert.equal(sampledState.coverageMode, "sampled");
  assert.equal(sampledState.status, "unsupported");

  assert.deepEqual(sourceSyncInternals.getAllowedOrigin(undefined), []);
  assert.deepEqual(sourceSyncInternals.getAllowedOrigin("not-a-url"), []);
  assert.deepEqual(
    sourceSyncInternals.getAllowedOrigins(
      "https://example.com/path",
      "https://example.com/other",
      "https://another.test/value",
      undefined,
      "invalid",
    ),
    ["https://example.com", "https://another.test"],
  );

  const normalized = sourceSyncInternals.toSameOriginUrl(
    "/plugins/acme/toolbox?foo=1#details",
    "https://clawhub.ai/catalog",
  );
  assert.equal(normalized.length, 1);
  assert.equal(
    normalized[0]?.toString(),
    "https://clawhub.ai/plugins/acme/toolbox",
  );
  assert.deepEqual(
    sourceSyncInternals.toSameOriginUrl(
      "https://[::1",
      "https://clawhub.ai/catalog",
    ),
    [],
  );

  assert.equal(
    sourceSyncInternals.buildDisplayNameFromUrl(new URL("https://clawhub.ai/")),
    "clawhub.ai",
  );
  assert.equal(
    sourceSyncInternals.buildDisplayNameFromUrl(
      new URL("https://clawhub.ai/plugins/acme%20toolbox"),
    ),
    "acme toolbox",
  );
  assert.equal(
    sourceSyncInternals.buildManifestEntryFromUrl(
      new URL("https://clawhub.ai/"),
    ),
    undefined,
  );
  assert.equal(
    sourceSyncInternals.buildManifestEntryFromUrl(
      new URL("https://clawhub.ai/plugins/acme%20toolbox"),
    ),
    "plugins/acme toolbox",
  );
  assert.deepEqual(sourceSyncInternals.decodePathSegments("/bad/%E0%A4%A/ok"), [
    "bad",
    "%E0%A4%A",
    "ok",
  ]);
  assert.equal(
    sourceSyncInternals.extractPypiPackageNameFromUrl(
      new URL("https://pypi.org/simple/fastmcp/"),
    ),
    undefined,
  );
  assert.equal(
    sourceSyncInternals.extractPypiPackageNameFromUrl(
      new URL("https://pypi.org/project/fastmcp/"),
    ),
    "fastmcp",
  );
  assert.equal(
    sourceSyncInternals.extractSwiftPackageNameFromUrl(
      new URL("https://swiftpackageindex.com/acme"),
    ),
    undefined,
  );
  assert.equal(
    sourceSyncInternals.extractSwiftPackageNameFromUrl(
      new URL("https://swiftpackageindex.com/acme/SwiftAgent"),
    ),
    "acme/SwiftAgent",
  );
  assert.deepEqual(sourceSyncInternals.normalizeStringArray(["a", 1, "b"]), [
    "a",
    "b",
  ]);
  assert.deepEqual(sourceSyncInternals.normalizeStringArray("nope"), []);
  assert.deepEqual(sourceSyncInternals.asRecord(null), {});
  assert.deepEqual(sourceSyncInternals.asRecord([1, 2, 3]), {});
  assert.deepEqual(sourceSyncInternals.asRecord({ ok: true }), { ok: true });
  assert.equal(sourceSyncInternals.getString("value"), "value");
  assert.equal(sourceSyncInternals.getString(""), undefined);
  assert.equal(sourceSyncInternals.getNumber(42), 42);
  assert.equal(
    sourceSyncInternals.getNumber(Number.POSITIVE_INFINITY),
    undefined,
  );
});

void test("source sync helper exports cover registry sync edge branches", async () => {
  const cleanupFetch = installFetchMock(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    switch (url) {
      case "https://pypi.org/sitemap.xml":
        return xmlResponse([
          "<sitemapindex>",
          "<sitemap><loc>https://pypi.org/00.sitemap.xml</loc></sitemap>",
          "</sitemapindex>",
        ]);
      case "https://pypi.org/00.sitemap.xml":
        return xmlResponse([
          "<urlset>",
          "<url><loc>https://pypi.org/project/</loc></url>",
          "</urlset>",
        ]);
      case "https://rubygems.org/gems?page=1":
        return textResponse('<a href="/gems//">Broken</a>');
      case "https://registry.modelcontextprotocol.io/v0/servers":
        return jsonResponse({
          servers: "not-an-array",
          metadata: { nextCursor: "later" },
        });
      case "https://registry.modelcontextprotocol.io/v0/servers?cursor=next-page":
        return jsonResponse({
          servers: [
            {
              server: { name: "old/server" },
              _meta: {
                "io.modelcontextprotocol.registry/official": {
                  isLatest: false,
                },
              },
            },
            {
              server: {
                name: "io.acme/server",
                remotes: [
                  {
                    type: "streamable-http",
                    url: "https://mcp.acme.test/server",
                  },
                ],
              },
            },
          ],
          metadata: {},
        });
      case "https://replicate.npmjs.com/_changes?since=0&limit=50":
        return jsonResponse({ last_seq: "done", results: "not-an-array" });
      case "https://replicate.npmjs.com/_changes?since=7&limit=50":
        return jsonResponse({
          last_seq: { unsupported: true },
          results: [
            { id: "deleted-pkg", deleted: true },
            { missing: "id-field" },
            { id: "missing-metadata" },
            { id: "valid-pkg" },
          ],
        });
      case "https://registry.npmjs.org/missing-metadata":
        return new Response("", { status: 404 });
      case "https://registry.npmjs.org/valid-pkg":
        return jsonResponse({
          name: "valid-pkg",
          repository: "https://github.com/acme/valid-pkg",
          time: { modified: "2026-05-10T00:00:00.000Z" },
        });
      case "https://crates.io/api/v1/crates?page=1&per_page=50":
        return jsonResponse({
          crates: [
            { description: "missing package name" },
            ...Array.from({ length: 49 }, (_, index) => ({
              id: `cargo-agent-${index + 1}`,
              homepage: `https://crates.example/cargo-agent-${index + 1}`,
              updated_at: "2026-05-09T00:00:00.000Z",
            })),
          ],
        });
      case "https://crates.io/api/v1/crates-malformed?page=1&per_page=50":
        return jsonResponse({ crates: "not-an-array" });
      case "https://crates.io/api/v1/crates-fallback?page=1&per_page=50":
        return jsonResponse({
          crates: [
            {
              name: "name-only-crate",
              repository: "https://github.com/acme/name-only-crate",
            },
            {
              name: "no-url-crate",
            },
          ],
        });
      case "https://index.golang.org/index?since=1970-01-01T00%3A00%3A00Z&limit=50":
        return textResponse(
          [
            '{"bad":',
            '{"Timestamp":"2026-05-08T00:00:00Z"}',
            '{"Path":"github.com/acme/go-agent"}',
          ].join("\n"),
        );
      // Empty Go feed: all rows lack a valid Path — lastPath stays null,
      // buildGoCursorToken is called with null lastSeenPath.
      case "https://index.golang.org/index-empty?since=1970-01-01T00%3A00%3A00Z&limit=50":
        return textResponse('{"Timestamp":"2026-05-08T00:00:00Z"}');
      // Resume mid-bucket: cursor is "2026-05-09T00:00:00Z|github.com/acme/alpha"
      // The feed returns alpha again + beta at the same timestamp + gamma at new ts.
      case "https://index.golang.org/index?since=2026-05-09T00%3A00%3A00Z&limit=50":
        return textResponse(
          [
            '{"Path":"github.com/acme/alpha","Timestamp":"2026-05-09T00:00:00Z"}',
            '{"Path":"github.com/acme/beta","Timestamp":"2026-05-09T00:00:00Z"}',
            '{"Path":"github.com/acme/gamma","Timestamp":"2026-05-10T00:00:00Z"}',
          ].join("\n"),
        );
      // New-timestamp-on-first-row: cursor "2026-05-11T00:00:00Z|github.com/acme/omega"
      // Feed starts at 2026-05-12 (different ts bucket) — pastTieBreaker fires on first row.
      case "https://index.golang.org/index?since=2026-05-11T00%3A00%3A00Z&limit=50":
        return textResponse(
          [
            '{"Path":"github.com/acme/delta","Timestamp":"2026-05-12T00:00:00Z"}',
            '{"Path":"github.com/acme/epsilon","Timestamp":"2026-05-12T00:00:00Z"}',
          ].join("\n"),
        );
      case "https://search.maven.org/solrsearch/select?q=*%3A*&rows=50&start=0&wt=json":
        return jsonResponse({
          response: {
            docs: [{ g: "com.acme" }, { g: "com.acme", a: "agent-core" }],
          },
        });
      case "https://search.maven.org/solrsearch/malformed?q=*%3A*&rows=50&start=0&wt=json":
        return jsonResponse({ response: { docs: "not-an-array" } });
      case "https://search.maven.org/solrsearch/partial?q=*%3A*&rows=50&start=0&wt=json":
        return jsonResponse({
          response: {
            numFound: 100,
            docs: Array.from({ length: 50 }, (_, index) => ({
              g: "com.acme",
              a: `agent-${index}`,
              timestamp: 1_700_000_000_000 + index,
            })),
          },
        });
      case "https://api.nuget.org/v3/query?q=&skip=0&take=50&prerelease=true&semVerLevel=2.0.0":
        return jsonResponse({
          data: [{ description: "missing id" }, { id: "Acme.AgentTools" }],
        });
      case "https://api.nuget.org/v3/query-malformed?q=&skip=0&take=50&prerelease=true&semVerLevel=2.0.0":
        return jsonResponse({ data: "not-an-array" });
      case "https://api.nuget.org/v3/query-partial?q=&skip=0&take=50&prerelease=true&semVerLevel=2.0.0":
        return jsonResponse({
          totalHits: 100,
          data: Array.from({ length: 50 }, (_, index) => ({
            id: `Acme.AgentTools.${index}`,
            tags: ["agent", 12, "tools"],
          })),
        });
      default:
        throw new Error(`Unexpected fetch: ${url}`);
    }
  });

  try {
    const pypiContext = buildSourceSyncContext();
    const pypiResult =
      await sourceSyncInternals.syncSitemapPackageRegistrySource(
        buildSourceDefinition("pypi-registry", "package-registry", {
          baseUrl: "https://pypi.org",
          sitemapUrl: "https://pypi.org/sitemap.xml",
        }),
        pypiContext,
        {
          rootSitemapUrl: "https://pypi.org/sitemap.xml",
          itemUrlPredicate: (url: URL) => url.pathname.startsWith("/project/"),
          packageNameFromUrl: sourceSyncInternals.extractPypiPackageNameFromUrl,
        },
      );
    assert.equal(pypiResult.status, "complete");
    assert.equal(pypiResult.indexedEntryCount, 0);

    const rubygemsContext = buildSourceSyncContext();
    const rubygemsResult =
      await sourceSyncInternals.syncHtmlPackageRegistrySource(
        buildSourceDefinition("rubygems-registry", "package-registry", {
          baseUrl: "https://rubygems.org",
        }),
        rubygemsContext,
        {
          pageUrlTemplate: "https://rubygems.org/gems?page={page}",
          linkPattern: /\/gems\/[^"'\s<>()?#]+/gu,
          packageNameFromPath: (url: URL) =>
            sourceSyncInternals.decodePathSegments(url.pathname)[1],
        },
      );
    assert.equal(rubygemsResult.status, "complete");
    assert.equal(rubygemsResult.indexedEntryCount, 0);

    // Missing {page} in template AND no pageUrlForNumber — must throw.
    await assert.rejects(
      () =>
        sourceSyncInternals.syncHtmlPackageRegistrySource(
          buildSourceDefinition("rubygems-registry", "package-registry", {
            baseUrl: "https://rubygems.org",
          }),
          buildSourceSyncContext(),
          {
            pageUrlTemplate: "https://rubygems.org/gems",
            linkPattern: /\/gems\/[^"'\s<>()?#]+/gu,
            packageNameFromPath: (url: URL) =>
              sourceSyncInternals.decodePathSegments(url.pathname)[1],
          },
        ),
      /does not contain "\{page\}"/u,
    );

    const mcpContext = buildSourceSyncContext({
      sourceId: "mcp-registry",
      coverageMode: "indexed",
      status: "partial",
      indexedEntryCount: 0,
      cursors: [
        { cursorId: "cursor", nextToken: "next-page", completed: false },
      ],
    });
    const mcpResult = await sourceSyncInternals.syncMcpRegistrySource(
      buildSourceDefinition("mcp-registry", "registry", {
        baseUrl: "https://registry.modelcontextprotocol.io/",
        apiUrl: "https://registry.modelcontextprotocol.io/v0/servers",
      }),
      mcpContext,
    );
    assert.equal(mcpResult.status, "complete");
    assert.equal(mcpResult.cursors[0]?.completed, true);
    assert.equal(mcpContext.entriesById.size, 1);

    await withEnv(
      { AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1" },
      async () => {
        const sparseMcpContext = buildSourceSyncContext();
        const sparseMcpResult = await sourceSyncInternals.syncMcpRegistrySource(
          buildSourceDefinition("mcp-registry", "registry", {
            baseUrl: "https://registry.modelcontextprotocol.io/",
            apiUrl: "https://registry.modelcontextprotocol.io/v0/servers",
          }),
          sparseMcpContext,
        );
        assert.equal(sparseMcpResult.status, "partial");
        assert.equal(sparseMcpResult.cursors[0]?.nextToken, "later");
        assert.equal(sparseMcpContext.entriesById.size, 0);
      },
    );

    const emptyNpmContext = buildSourceSyncContext({
      sourceId: "npm-registry",
      coverageMode: "indexed",
      status: "partial",
      indexedEntryCount: 0,
      cursors: [{ cursorId: "changes", completed: false }],
    });
    const emptyNpmResult = await sourceSyncInternals.syncNpmRegistrySource(
      buildSourceDefinition("npm-registry", "package-registry", {
        baseUrl: "https://www.npmjs.com",
      }),
      emptyNpmContext,
    );
    assert.equal(emptyNpmResult.status, "partial");
    assert.equal(emptyNpmResult.cursors[0]?.nextToken, "done");
    assert.equal(emptyNpmContext.entriesById.size, 0);

    const npmContext = buildSourceSyncContext({
      sourceId: "npm-registry",
      coverageMode: "indexed",
      status: "partial",
      indexedEntryCount: 0,
      cursors: [{ cursorId: "changes", nextToken: "7", completed: false }],
    });
    const npmResult = await sourceSyncInternals.syncNpmRegistrySource(
      buildSourceDefinition("npm-registry", "package-registry", {
        baseUrl: "https://www.npmjs.com",
      }),
      npmContext,
    );
    assert.equal(npmResult.status, "partial");
    assert.equal(npmResult.cursors[0]?.nextToken, "7");
    assert.equal(npmContext.entriesById.size, 1);
    assert.equal(npmContext.entriesById.has("missing-metadata"), false);

    // deleted-pkg: pre-seed the entry then verify the feed's deleted:true removes it
    const npmDeletedContext = buildSourceSyncContext({
      sourceId: "npm-registry",
      coverageMode: "indexed",
      status: "partial",
      indexedEntryCount: 1,
      cursors: [{ cursorId: "changes", nextToken: "7", completed: false }],
    });
    const deletedEntryId = buildCatalogId("npm-registry:npm", "deleted-pkg");
    // Manually seed the entry as if it was indexed in a prior run.
    npmDeletedContext.entriesById.set(deletedEntryId, {
      id: deletedEntryId,
    } as AssetCatalogEntry);
    assert.equal(npmDeletedContext.entriesById.size, 1);
    await sourceSyncInternals.syncNpmRegistrySource(
      buildSourceDefinition("npm-registry", "package-registry", {
        baseUrl: "https://www.npmjs.com",
      }),
      npmDeletedContext,
    );
    // deleted-pkg was removed; valid-pkg was added
    assert.equal(npmDeletedContext.entriesById.has(deletedEntryId), false);
    assert.equal(
      npmDeletedContext.entriesById.has(
        buildCatalogId("npm-registry:npm", "valid-pkg"),
      ),
      true,
    );

    await withEnv(
      { AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1" },
      async () => {
        const cargoContext = buildSourceSyncContext();
        const cargoResult = await sourceSyncInternals.syncCargoRegistrySource(
          buildSourceDefinition("cargo-registry", "package-registry", {
            baseUrl: "https://crates.io",
          }),
          cargoContext,
        );
        assert.equal(cargoResult.status, "partial");
        assert.equal(cargoResult.cursors[0]?.nextToken, "2");
        assert.equal(cargoContext.entriesById.size, 49);

        const malformedCargoContext = buildSourceSyncContext();
        const malformedCargoResult =
          await sourceSyncInternals.syncCargoRegistrySource(
            buildSourceDefinition("cargo-registry", "package-registry", {
              baseUrl: "https://crates.io",
              apiUrl: "https://crates.io/api/v1/crates-malformed",
            }),
            malformedCargoContext,
          );
        assert.equal(malformedCargoResult.status, "complete");
        assert.equal(malformedCargoContext.entriesById.size, 0);

        const fallbackCargoContext = buildSourceSyncContext();
        const fallbackCargoResult =
          await sourceSyncInternals.syncCargoRegistrySource(
            buildSourceDefinition("cargo-registry", "package-registry", {
              baseUrl: "https://crates.io",
              apiUrl: "https://crates.io/api/v1/crates-fallback",
            }),
            fallbackCargoContext,
          );
        assert.equal(fallbackCargoResult.status, "complete");
        assert.equal(fallbackCargoContext.entriesById.size, 2);
        const fallbackCargoEntries = [
          ...fallbackCargoContext.entriesById.values(),
        ].sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        );
        assert.equal(fallbackCargoEntries[0]?.displayName, "name-only-crate");
        assert.equal(
          fallbackCargoEntries[0]?.source.originUrl,
          "https://github.com/acme/name-only-crate",
        );
        assert.equal(fallbackCargoEntries[1]?.displayName, "no-url-crate");
        assert.equal(
          fallbackCargoEntries[1]?.source.originUrl,
          "https://crates.io/crates/no-url-crate",
        );

        const goContext = buildSourceSyncContext({
          sourceId: "go-registry",
          coverageMode: "indexed",
          status: "partial",
          indexedEntryCount: 0,
          cursors: [{ cursorId: "index", completed: false }],
        });
        const goResult = await sourceSyncInternals.syncGoRegistrySource(
          buildSourceDefinition("go-registry", "package-registry", {
            baseUrl: "https://pkg.go.dev",
          }),
          goContext,
        );
        assert.equal(goResult.status, "partial");
        assert.equal(
          goResult.cursors[0]?.nextToken,
          "1970-01-01T00:00:00Z|github.com/acme/go-agent",
        );
        assert.equal(goContext.entriesById.size, 1);

        // Empty Go feed: all rows lack a valid Path → lastPath stays null
        // → buildGoCursorToken(ts, null) returns plain timestamp token.
        const goEmptyContext = buildSourceSyncContext({
          sourceId: "go-registry",
          coverageMode: "indexed",
          status: "partial",
          indexedEntryCount: 0,
          cursors: [{ cursorId: "index", completed: false }],
        });
        const goEmptyResult = await sourceSyncInternals.syncGoRegistrySource(
          buildSourceDefinition("go-empty", "package-registry", {
            baseUrl: "https://pkg.go.dev",
            indexApi: "https://index.golang.org/index-empty",
          }),
          goEmptyContext,
        );
        assert.equal(goEmptyResult.status, "partial");
        assert.equal(
          goEmptyResult.cursors[0]?.nextToken,
          "1970-01-01T00:00:00Z",
        );
        assert.equal(goEmptyContext.entriesById.size, 0);

        // Tie-breaker resume: cursor stored as "2026-05-09T00:00:00Z|github.com/acme/alpha"
        // Feed replays alpha + new beta at same ts + gamma at new ts.
        // Expected: only beta and gamma are added (alpha already processed).
        const goResumeContext = buildSourceSyncContext({
          sourceId: "go-registry",
          coverageMode: "indexed",
          status: "partial",
          indexedEntryCount: 1,
          cursors: [
            {
              cursorId: "index",
              nextToken: "2026-05-09T00:00:00Z|github.com/acme/alpha",
              completed: false,
            },
          ],
        });
        const goResumeResult = await sourceSyncInternals.syncGoRegistrySource(
          buildSourceDefinition("go-registry", "package-registry", {
            baseUrl: "https://pkg.go.dev",
          }),
          goResumeContext,
        );
        assert.equal(goResumeResult.status, "partial");
        assert.equal(
          goResumeResult.cursors[0]?.nextToken,
          "2026-05-10T00:00:00Z|github.com/acme/gamma",
        );
        // beta and gamma were added; alpha was skipped (already processed)
        assert.equal(goResumeContext.entriesById.size, 2);
        assert.equal(
          goResumeContext.entriesById.has(
            buildCatalogId("go-registry:go", "github.com/acme/beta"),
          ),
          true,
        );
        assert.equal(
          goResumeContext.entriesById.has(
            buildCatalogId("go-registry:go", "github.com/acme/gamma"),
          ),
          true,
        );

        // New-timestamp-on-first-row: cursor stored as "2026-05-11T00:00:00Z|github.com/acme/omega"
        // but the feed jumps straight to a new timestamp (no bucket overlap).
        // pastTieBreaker must flip on the very first row so it is processed.
        const goFreshTsContext = buildSourceSyncContext({
          sourceId: "go-registry",
          coverageMode: "indexed",
          status: "partial",
          indexedEntryCount: 0,
          cursors: [
            {
              cursorId: "index",
              nextToken: "2026-05-11T00:00:00Z|github.com/acme/omega",
              completed: false,
            },
          ],
        });
        const goFreshTsResult = await sourceSyncInternals.syncGoRegistrySource(
          buildSourceDefinition("go-registry", "package-registry", {
            baseUrl: "https://pkg.go.dev",
          }),
          goFreshTsContext,
        );
        assert.equal(goFreshTsResult.status, "partial");
        // delta and epsilon both at 2026-05-12 — new-timestamp branch fires on first,
        // then pastTieBreaker stays true for the rest. Both should be indexed.
        assert.equal(goFreshTsContext.entriesById.size, 2);
        assert.ok(
          goFreshTsContext.entriesById.has(
            buildCatalogId("go-registry:go", "github.com/acme/delta"),
          ),
        );
        assert.ok(
          goFreshTsContext.entriesById.has(
            buildCatalogId("go-registry:go", "github.com/acme/epsilon"),
          ),
        );

        // Pre-lastSeenPath rows in the same bucket (the else-continue branch):
        // Use a cursor set to "alpha" but the feed also sends "aardvark" before it.
        const goPreSeedContext = buildSourceSyncContext({
          sourceId: "go-registry",
          coverageMode: "indexed",
          status: "partial",
          indexedEntryCount: 0,
          cursors: [
            {
              cursorId: "index",
              nextToken: "2026-05-09T00:00:00Z|github.com/acme/beta",
              completed: false,
            },
          ],
        });
        const goPreSeedResult = await sourceSyncInternals.syncGoRegistrySource(
          buildSourceDefinition("go-registry", "package-registry", {
            baseUrl: "https://pkg.go.dev",
          }),
          goPreSeedContext,
        );
        assert.equal(goPreSeedResult.status, "partial");
        // alpha comes before beta in the same bucket — hits the else-continue branch.
        // Only gamma (new ts) should be added.
        assert.ok(
          !goPreSeedContext.entriesById.has(
            buildCatalogId("go-registry:go", "github.com/acme/alpha"),
          ),
        );
        assert.ok(
          goPreSeedContext.entriesById.has(
            buildCatalogId("go-registry:go", "github.com/acme/gamma"),
          ),
        );

        const mavenContext = buildSourceSyncContext();
        const mavenResult = await sourceSyncInternals.syncMavenRegistrySource(
          buildSourceDefinition("maven-registry", "package-registry", {
            baseUrl: "https://central.sonatype.com",
          }),
          mavenContext,
        );
        assert.equal(mavenResult.status, "complete");
        assert.equal(mavenContext.entriesById.size, 1);

        const malformedMavenContext = buildSourceSyncContext();
        const malformedMavenResult =
          await sourceSyncInternals.syncMavenRegistrySource(
            buildSourceDefinition("maven-registry", "package-registry", {
              baseUrl: "https://central.sonatype.com",
              searchApi: "https://search.maven.org/solrsearch/malformed",
            }),
            malformedMavenContext,
          );
        assert.equal(malformedMavenResult.status, "complete");
        assert.equal(malformedMavenContext.entriesById.size, 0);

        const partialMavenContext = buildSourceSyncContext();
        const partialMavenResult =
          await sourceSyncInternals.syncMavenRegistrySource(
            buildSourceDefinition("maven-registry", "package-registry", {
              baseUrl: "https://central.sonatype.com",
              searchApi: "https://search.maven.org/solrsearch/partial",
            }),
            partialMavenContext,
          );
        assert.equal(partialMavenResult.status, "partial");
        assert.equal(partialMavenContext.entriesById.size, 50);

        const nugetContext = buildSourceSyncContext();
        const nugetResult = await sourceSyncInternals.syncNuGetRegistrySource(
          buildSourceDefinition("nuget-registry", "package-registry", {
            baseUrl: "https://www.nuget.org",
            queryApi: "https://api.nuget.org/v3/query",
          }),
          nugetContext,
        );
        assert.equal(nugetResult.status, "complete");
        assert.equal(nugetContext.entriesById.size, 1);

        const malformedNugetContext = buildSourceSyncContext();
        const malformedNugetResult =
          await sourceSyncInternals.syncNuGetRegistrySource(
            buildSourceDefinition("nuget-registry", "package-registry", {
              baseUrl: "https://www.nuget.org",
              queryApi: "https://api.nuget.org/v3/query-malformed",
            }),
            malformedNugetContext,
          );
        assert.equal(malformedNugetResult.status, "complete");
        assert.equal(malformedNugetContext.entriesById.size, 0);

        const partialNugetContext = buildSourceSyncContext();
        const partialNugetResult =
          await sourceSyncInternals.syncNuGetRegistrySource(
            buildSourceDefinition("nuget-registry", "package-registry", {
              baseUrl: "https://www.nuget.org",
              queryApi: "https://api.nuget.org/v3/query-partial",
            }),
            partialNugetContext,
          );
        assert.equal(partialNugetResult.status, "partial");
        assert.equal(partialNugetContext.entriesById.size, 50);
      },
    );
  } finally {
    cleanupFetch();
  }
});

void test("source sync helper exports cover sitemap, fetch, NuGet, and MCP branches", async () => {
  const cleanupFetch = installFetchMock(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    switch (url) {
      case "https://api.nuget.org/v3/query":
        return jsonResponse({});
      case "https://api.nuget.org/v3/index.json":
        return jsonResponse({
          resources: [
            {
              "@id": "https://api.nuget.org/v3/query",
              "@type": "SearchQueryService/3.5.0",
            },
          ],
        });
      case "https://api.nuget.org/v3/missing.json":
        return jsonResponse({ resources: [] });
      case "https://api.nuget.org/v3/malformed.json":
        return jsonResponse({ resources: "not-an-array" });
      case "https://example.com/root.xml":
        return xmlResponse([
          "<sitemapindex>",
          "<sitemap><loc>https://example.com/leaf.xml?x=1</loc></sitemap>",
          "<sitemap><loc>https://other.example/skip.xml</loc></sitemap>",
          "</sitemapindex>",
        ]);
      case "https://example.com/plain.xml":
        return xmlResponse(["<urlset></urlset>"]);
      case "https://example.com/root-no-leaves.xml":
        return xmlResponse([
          "<sitemapindex>",
          "<sitemap><loc>https://example.com/not-index.xml</loc></sitemap>",
          "</sitemapindex>",
        ]);
      case "https://example.com/text-ok":
        return textResponse("hello");
      case "https://example.com/json-ok":
        return jsonResponse({ ok: true });
      case "https://example.com/text-null":
      case "https://example.com/json-null":
        return new Response("", { status: 404 });
      default:
        throw new Error(`Unexpected fetch: ${url}`);
    }
  });

  try {
    const source = buildSourceDefinition("mcp-registry", "registry", {
      baseUrl: "notaurl",
    });
    const context = buildSourceSyncContext();

    assert.equal(
      await sourceSyncInternals.resolveNuGetSearchQueryServiceUrl(
        buildSourceDefinition("nuget-registry", "package-registry", {
          queryApi: "https://api.nuget.org/v3/query",
        }),
      ),
      "https://api.nuget.org/v3/query",
    );
    assert.equal(
      await sourceSyncInternals.resolveNuGetSearchQueryServiceUrl(
        buildSourceDefinition("nuget-registry", "package-registry", {
          serviceIndexUrl: "https://api.nuget.org/v3/index.json",
        }),
      ),
      "https://api.nuget.org/v3/query",
    );
    await assert.rejects(
      () =>
        sourceSyncInternals.resolveNuGetSearchQueryServiceUrl(
          buildSourceDefinition("nuget-registry", "package-registry", {
            serviceIndexUrl: "https://api.nuget.org/v3/missing.json",
          }),
        ),
      /SearchQueryService endpoint/u,
    );
    await assert.rejects(
      () =>
        sourceSyncInternals.resolveNuGetSearchQueryServiceUrl(
          buildSourceDefinition("nuget-registry", "package-registry", {
            serviceIndexUrl: "https://api.nuget.org/v3/malformed.json",
          }),
        ),
      /SearchQueryService endpoint/u,
    );

    assert.equal(
      await sourceSyncInternals.fetchRequiredText(
        "https://example.com/text-ok",
        ["https://example.com"],
      ),
      "hello",
    );
    assert.deepEqual(
      await sourceSyncInternals.fetchRequiredJson(
        "https://example.com/json-ok",
        ["https://example.com"],
      ),
      { ok: true },
    );
    await assert.rejects(
      () =>
        sourceSyncInternals.fetchRequiredText("https://example.com/text-null", [
          "https://example.com",
        ]),
      /Failed to fetch https:\/\/example.com\/text-null/u,
    );
    await assert.rejects(
      () =>
        sourceSyncInternals.fetchRequiredJson("https://example.com/json-null", [
          "https://example.com",
        ]),
      /Failed to fetch https:\/\/example.com\/json-null/u,
    );

    assert.deepEqual(
      sourceSyncInternals
        .parseSitemapIndex(
          "<sitemapindex><sitemap><loc>https://example.com/leaf.xml?x=1</loc></sitemap></sitemapindex>",
          "https://example.com/root.xml",
        )
        .map((url: URL) => url.toString()),
      ["https://example.com/leaf.xml"],
    );
    assert.deepEqual(
      sourceSyncInternals
        .parseUrlSet(
          "<urlset><url><loc>https://example.com/item?a=1#b</loc></url></urlset>",
          "https://example.com/root.xml",
        )
        .map((url: URL) => url.toString()),
      ["https://example.com/item"],
    );
    assert.deepEqual(
      await sourceSyncInternals.resolveSitemapLeafUrls(
        "https://example.com/plain.xml",
        ["https://example.com"],
      ),
      ["https://example.com/plain.xml"],
    );
    assert.deepEqual(
      await sourceSyncInternals.resolveSitemapLeafUrls(
        "https://example.com/root.xml",
        ["https://example.com"],
        (url: URL) => url.pathname.endsWith("leaf.xml"),
      ),
      ["https://example.com/leaf.xml"],
    );
    assert.deepEqual(
      await sourceSyncInternals.resolveSitemapLeafUrls(
        "https://example.com/root.xml",
        ["https://example.com"],
        (url: URL) => url.pathname.endsWith("missing.xml"),
      ),
      [],
    );
    const noLeafSitemapResult =
      await sourceSyncInternals.syncSitemapPackageRegistrySource(
        buildSourceDefinition("pypi-registry", "package-registry", {
          baseUrl: "https://pypi.org",
          sitemapUrl: "https://example.com/root-no-leaves.xml",
        }),
        buildSourceSyncContext(),
        {
          rootSitemapUrl: "https://example.com/root-no-leaves.xml",
          leafSitemapPredicate: (url: URL) => url.pathname.endsWith("leaf.xml"),
          packageNameFromUrl: sourceSyncInternals.extractPypiPackageNameFromUrl,
        },
      );
    assert.equal(noLeafSitemapResult.status, "failed");

    assert.equal(
      sourceSyncInternals.isLatestMcpRegistryEntry({
        _meta: {
          "io.modelcontextprotocol.registry/official": { isLatest: false },
        },
      }),
      false,
    );
    assert.equal(sourceSyncInternals.isLatestMcpRegistryEntry({}), true);
    assert.equal(
      sourceSyncInternals.getMcpRegistryUpdatedAt({
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            publishedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      }),
      "2026-05-10T00:00:00.000Z",
    );
    assert.equal(
      sourceSyncInternals.getMcpRegistryUpdatedAt({
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            statusChangedAt: "2026-05-11T00:00:00.000Z",
          },
        },
      }),
      "2026-05-11T00:00:00.000Z",
    );
    assert.equal(sourceSyncInternals.getMcpRegistryUpdatedAt({}), undefined);
    assert.equal(
      sourceSyncInternals.buildMcpRegistryOriginUrl(
        "notaurl",
        "io.acme/agent",
        "https://fallback.test/server",
      ),
      "https://fallback.test/server",
    );
    assert.equal(
      sourceSyncInternals.buildMcpRegistryOriginUrl(
        "notaurl",
        "io.acme/agent",
        undefined,
      ),
      "io.acme/agent",
    );
    assert.deepEqual(
      sourceSyncInternals.extractMcpRegistryRemoteTypes({
        remotes: [{ type: "streamable-http" }, { type: 12 }, {}],
      }),
      ["streamable-http"],
    );
    assert.deepEqual(sourceSyncInternals.extractMcpRegistryRemoteTypes({}), []);
    assert.deepEqual(
      sourceSyncInternals
        .dedupeUrls([
          new URL("https://example.com/one"),
          new URL("https://example.com/one"),
          new URL("https://example.com/two"),
        ])
        .map((url: URL) => url.toString()),
      ["https://example.com/one", "https://example.com/two"],
    );
    assert.equal(
      sourceSyncInternals.isAllowedOriginUrl(
        new URL("https://example.com/path"),
        ["https://EXAMPLE.com"],
      ),
      true,
    );
    assert.equal(
      sourceSyncInternals.countEntriesForSource(
        new Map<string, AssetCatalogEntry>([
          ["first", buildIndexedEntry("first", ["one"])],
          ["second", buildIndexedEntry("second", ["two"])],
        ]),
        "vscode-marketplace",
      ),
      2,
    );

    assert.equal(
      sourceSyncInternals.buildMcpRegistryCatalogEntry(source, context, {
        server: {},
      }),
      null,
    );
    const mcpEntry = sourceSyncInternals.buildMcpRegistryCatalogEntry(
      source,
      context,
      {
        server: {
          name: "io.acme/agent-registry",
          title: "Acme Registry",
          description: "Hosted registry",
          remotes: [
            { type: "streamable-http", url: "https://mcp.acme.test/server" },
            { type: "streamable-http" },
          ],
        },
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            statusChangedAt: "2026-05-12T00:00:00.000Z",
          },
        },
      },
    );

    assert.equal(
      mcpEntry?.displayName,
      "Acme Registry (io.acme/agent-registry)",
    );
    assert.equal(mcpEntry?.source.originUrl, "https://mcp.acme.test/server");
    assert.equal(mcpEntry?.maintenance.lastUpdated, "2026-05-12T00:00:00.000Z");
  } finally {
    cleanupFetch();
  }
});

void test("fetchRequiredJson defaults the HTTP method per the documented contract (review)", async () => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  const seen: Array<{
    url: string;
    method?: string;
    headers?: Record<string, string>;
  }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
    });
    return jsonResponse({ ok: true });
  }) as typeof fetch;
  try {
    await sourceSyncInternals.fetchRequiredJson(
      "https://example.com/json-method",
      ["https://example.com"],
      {},
      { body: "{}" },
    );
    await sourceSyncInternals.fetchRequiredJson(
      "https://example.com/json-get",
      ["https://example.com"],
    );
    await sourceSyncInternals.fetchRequiredJson(
      "https://example.com/json-post",
      ["https://example.com"],
      {},
      { method: "POST", body: "{}" },
    );
    // Custom headers may arrive in ANY HeadersInit form; a Headers
    // instance must merge over the base set (review).
    await sourceSyncInternals.fetchRequiredJson(
      "https://example.com/json-headers",
      ["https://example.com"],
      {},
      {
        headers: new Headers({ "x-custom": "v1", Accept: "application/json" }),
      },
    );

    assert.equal(
      seen[0]?.method,
      "POST",
      "a body without an explicit method must default to POST (Fetch forbids GET with a body)",
    );
    assert.equal(
      seen[1]?.method,
      "GET",
      "no body and no method flows as an undefined method that the transport resolves to GET",
    );
    assert.equal(
      seen[2]?.method,
      "POST",
      "an explicit method must be preserved",
    );
    assert.equal(
      seen[3]?.headers?.["x-custom"],
      "v1",
      "a Headers-instance custom header must be forwarded",
    );
    assert.equal(
      seen[3]?.headers?.["user-agent"],
      "agent-harness",
      "the base source-sync headers must survive the merge (lowercased by Headers normalization)",
    );
    assert.equal(
      seen[3]?.headers?.["accept"],
      "application/json",
      "a custom header must override the base set value",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  }
});

function buildIndexedEntry(
  id: string,
  capabilities: string[],
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "extension",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "vscode-marketplace",
      sourceKind: "marketplace",
      authorityTier: "official-marketplace",
      sourcePriority: 80,
      originUrl: `https://marketplace.visualstudio.com/items?itemName=${id}`,
      publisher: "Acme",
      publisherVerified: true,
    },
    trust: {
      score: 100,
      signals: ["official-marketplace"],
    },
    capabilities,
    install: {
      method: "vscode-extension",
      manifestEntry: id,
      nativeHosts: ["copilot-vscode"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: "2026-05-10T00:00:00.000Z",
      stars: 123,
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
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 0.9,
      hostFit: 0.95,
    },
    dedupe: {
      candidateRankHint: "test",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function buildSourceDefinition(
  id: string,
  kind: SourceDefinition["kind"],
  endpoints: Record<string, string> = { baseUrl: "https://example.com" },
): SourceDefinition {
  return {
    id,
    name: id,
    kind,
    authorityTier: "official-marketplace",
    publisher: {
      name: "Acme",
      verified: true,
    },
    hosts: ["copilot-vscode"],
    assetKinds: ["plugin"],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints,
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildSelectionRegistry(): SelectionRegistry {
  return {
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
  };
}

function buildSourceSyncContext(previousState?: SourceSyncSourceState) {
  return {
    demandProfile: null,
    selectionRegistry: buildSelectionRegistry(),
    entriesById: new Map<string, AssetCatalogEntry>(),
    entriesDirty: false,
    previousState,
    observedEntryIds: new Set<string>(),
  };
}

function installFetchMock(
  responder: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> | Response,
): () => void {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  globalThis.fetch = async (input, init) => responder(input, init);

  return () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      setHttpTestFetchMocks(false);
      return;
    }
    restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
  };
}

async function withEnv(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<void>,
): Promise<void> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  clearRuntimeConfigForTests();

  try {
    await callback();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeConfigForTests();
  }
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function xmlResponse(lines: string[]): Response {
  return new Response(lines.join(""), {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

void test("normalizeSitemapCursorId normalizes skills.sh to www.skills.sh", () => {
  const { normalizeSitemapCursorId } = htmlSyncInternals;

  // skills.sh → www.skills.sh
  assert.equal(
    normalizeSitemapCursorId("https://skills.sh/sitemap-skills-1.xml"),
    "https://www.skills.sh/sitemap-skills-1.xml",
  );

  // www.skills.sh stays canonical
  assert.equal(
    normalizeSitemapCursorId("https://www.skills.sh/sitemap-skills-1.xml"),
    "https://www.skills.sh/sitemap-skills-1.xml",
  );

  // Other domains pass through unchanged
  assert.equal(
    normalizeSitemapCursorId("https://pypi.org/00.sitemap.xml"),
    "https://pypi.org/00.sitemap.xml",
  );

  // Non-URL cursor IDs pass through unchanged
  assert.equal(normalizeSitemapCursorId("page"), "page");
  assert.equal(normalizeSitemapCursorId(""), "");
});

void test("normalizeSitemapCursorId preserves query strings and paths", () => {
  const { normalizeSitemapCursorId } = htmlSyncInternals;

  assert.equal(
    normalizeSitemapCursorId("https://skills.sh/sitemap-skills-1.xml?foo=bar"),
    "https://www.skills.sh/sitemap-skills-1.xml?foo=bar",
  );
});

void test("normalizeSitemapCursorId enables resume from old-host cursor IDs after migration", () => {
  // Regression: when skills-sh migrated from skills.sh → www.skills.sh,
  // previously persisted cursors keyed by the old hostname must still be
  // found by the normalized lookup so sync progress is preserved.
  const { normalizeSitemapCursorId } = htmlSyncInternals;

  // Old cursor persisted before migration.
  const oldCursor = {
    cursorId: "https://skills.sh/sitemap-skills-1.xml",
    nextToken: "50",
    completed: false,
  };

  // New leaf URL discovered after migration.
  const newSitemapUrl = "https://www.skills.sh/sitemap-skills-1.xml";

  // Normalized keys must match.
  assert.equal(
    normalizeSitemapCursorId(oldCursor.cursorId),
    normalizeSitemapCursorId(newSitemapUrl),
    "old and new hostname cursors must normalize to the same key",
  );

  // Verify the normalized key is the canonical www form.
  assert.equal(
    normalizeSitemapCursorId(oldCursor.cursorId),
    "https://www.skills.sh/sitemap-skills-1.xml",
  );

  // Simulate the Map lookup used by syncSitemapSource: store old cursor,
  // retrieve by new URL.
  const cursorMap = new Map<string, typeof oldCursor>();
  cursorMap.set(normalizeSitemapCursorId(oldCursor.cursorId), oldCursor);

  const found = cursorMap.get(normalizeSitemapCursorId(newSitemapUrl));
  assert.ok(
    found !== undefined,
    "old cursor must be found by normalized lookup",
  );
  assert.equal(found.nextToken, "50", "nextToken must be preserved");
  assert.equal(found.completed, false);
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

void test("synchronizeIndexedSource dispatches ard-registry kind-guard", async () => {
  const ardSource = {
    id: "test-ard-registry",
    name: "Test ARD Registry",
    kind: "ard-registry" as const,
    enabled: true,
    endpoints: { searchUrl: "https://agenticresourcediscovery.org/search" },
    hosts: [] as string[],
    assetKinds: ["skill" as const],
    discoveryMode: "catalog" as const,
    priority: 70,
    authorityTier: "unverified-community" as const,
    rules: { officialPreferred: false, allowMirror: true, allowInstall: true },
  };

  const context = {
    demandProfile: null,
    selectionRegistry: {
      schemaVersion: 1,
      selectionPolicies: {
        officialBeatsPopularity: true,
        starsAreTieBreakerOnly: true,
        preferNativeOverAdaptable: true,
        preferLowerRiskWhenEquivalent: true,
        preferLowerContextCostWhenEquivalent: true,
        communityDefaultPolicy: "catalog-only-unless-promoted" as const,
      },
      rankingOrder: [],
      duplicateGroups: [],
    },
    entriesById: new Map(),
    entriesDirty: false,
    previousState: undefined,
    observedEntryIds: new Set<string>(),
  };

  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ version: "2026-08", results: [], pageToken: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof globalThis.fetch;

    const result = await sourceSyncInternals.synchronizeIndexedSource(
      ardSource,
      context,
    );

    assert.ok(result !== null, "ard-registry dispatch must return a state");
    assert.equal(result!.sourceId, "test-ard-registry");
    assert.equal(result!.coverageMode, "indexed");
    assert.equal(result!.status, "complete");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  }
});

void test("synchronizeIndexedSource category sweep tolerates a null demand profile (#451)", async () => {
  const vscodeSource = {
    id: "vscode-marketplace",
    name: "vscode-marketplace",
    kind: "marketplace" as const,
    enabled: true,
    endpoints: {
      baseUrl: "https://marketplace.visualstudio.com",
      marketplaceApi:
        "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
    },
    hosts: ["copilot-vscode"] as string[],
    assetKinds: ["extension" as const],
    discoveryMode: "catalog" as const,
    priority: 80,
    authorityTier: "official-marketplace" as const,
    rules: { officialPreferred: true, allowMirror: true, allowInstall: true },
  };

  const context = {
    demandProfile: null,
    selectionRegistry: {
      schemaVersion: 1,
      selectionPolicies: {
        officialBeatsPopularity: true,
        starsAreTieBreakerOnly: true,
        preferNativeOverAdaptable: true,
        preferLowerRiskWhenEquivalent: true,
        preferLowerContextCostWhenEquivalent: true,
        communityDefaultPolicy: "catalog-only-unless-promoted" as const,
      },
      rankingOrder: [],
      duplicateGroups: [],
    },
    entriesById: new Map(),
    entriesDirty: false,
    previousState: undefined,
    observedEntryIds: new Set<string>(),
  };

  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return textResponse("{}");
  }) as typeof globalThis.fetch;

  try {
    await withEnv(
      {
        AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES: "0",
        AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED: "true",
      },
      async () => {
        const result = await sourceSyncInternals.synchronizeIndexedSource(
          vscodeSource,
          context,
        );

        assert.ok(
          result !== null,
          "vscode-marketplace dispatch must return a state",
        );
        assert.equal(result!.sourceId, "vscode-marketplace");
        assert.equal(
          result!.status,
          "complete",
          "no demand profile means no categories, no queries, and nothing partial",
        );
      },
    );
    assert.equal(
      fetchCalls,
      1,
      "a null demand profile still runs the single default demand query, but no category sweeps",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  }
});

void test("syncSitemapPackageRegistrySource — unmapped registry kinds fail closed (no entries) while mapped kinds attribute correctly", async () => {
  const cleanupFetch = installFetchMock(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    switch (url) {
      case "https://example.com/sitemap.xml":
        return xmlResponse([
          "<sitemapindex>",
          "<sitemap><loc>https://example.com/leaf.xml</loc></sitemap>",
          "</sitemapindex>",
        ]);
      case "https://example.com/leaf.xml":
        return xmlResponse([
          "<urlset>",
          "<url><loc>https://example.com/packages/phoenix</loc></url>",
          "<url><loc>https://example.com/packages/ecto</loc></url>",
          "</urlset>",
        ]);
      default:
        throw new Error(`Unexpected fetch: ${url}`);
    }
  });

  try {
    // Unknown registry id: sitemap items must NOT be attributed to any
    // registry family (fail-closed, #424) — sync still completes structurally.
    const unknownContext = buildSourceSyncContext();
    const unknownResult =
      await sourceSyncInternals.syncSitemapPackageRegistrySource(
        buildSourceDefinition("unknown-registry", "package-registry", {
          baseUrl: "https://example.com",
          sitemapUrl: "https://example.com/sitemap.xml",
        }),
        unknownContext,
        {
          rootSitemapUrl: "https://example.com/sitemap.xml",
          itemUrlPredicate: (url: URL) => url.pathname.startsWith("/packages/"),
          packageNameFromUrl: (url: URL) => {
            const segments = url.pathname.split("/").filter(Boolean);
            return segments[segments.length - 1];
          },
        },
      );
    assert.equal(unknownResult.status, "complete");
    assert.equal(
      unknownResult.indexedEntryCount,
      0,
      "unmapped kind must attribute zero entries",
    );
    assert.equal(unknownContext.entriesById.size, 0);

    // hex-registry: items are attributed to hex.pm with hex-kind ids.
    const hexContext = buildSourceSyncContext();
    const hexResult =
      await sourceSyncInternals.syncSitemapPackageRegistrySource(
        buildSourceDefinition("hex-registry", "package-registry", {
          baseUrl: "https://hex.pm",
          sitemapUrl: "https://example.com/sitemap.xml",
        }),
        hexContext,
        {
          rootSitemapUrl: "https://example.com/sitemap.xml",
          itemUrlPredicate: (url: URL) => url.pathname.startsWith("/packages/"),
          packageNameFromUrl: (url: URL) => {
            const segments = url.pathname.split("/").filter(Boolean);
            return segments[segments.length - 1];
          },
        },
      );
    assert.equal(hexResult.status, "complete");
    assert.equal(hexResult.indexedEntryCount, 2);
    for (const entry of hexContext.entriesById.values()) {
      assert.match(entry.id, /^hex-registry:hex:/u);
      assert.equal(entry.source.sourceId, "hex-registry");
      assert.match(entry.source.originUrl, /^https:\/\/hex\.pm\/packages\//u);
    }

    // conan-registry: items are attributed to ConanCenter with conan-kind ids.
    const conanContext = buildSourceSyncContext();
    const conanResult =
      await sourceSyncInternals.syncSitemapPackageRegistrySource(
        buildSourceDefinition("conan-registry", "package-registry", {
          baseUrl: "https://conan.io",
          sitemapUrl: "https://example.com/sitemap.xml",
        }),
        conanContext,
        {
          rootSitemapUrl: "https://example.com/sitemap.xml",
          itemUrlPredicate: (url: URL) => url.pathname.startsWith("/packages/"),
          packageNameFromUrl: (url: URL) => {
            const segments = url.pathname.split("/").filter(Boolean);
            return segments[segments.length - 1];
          },
        },
      );
    assert.equal(conanResult.status, "complete");
    assert.equal(conanResult.indexedEntryCount, 2);
    for (const entry of conanContext.entriesById.values()) {
      assert.match(entry.id, /^conan-registry:conan:/u);
      assert.equal(entry.source.sourceId, "conan-registry");
      assert.match(
        entry.source.originUrl,
        /^https:\/\/conan\.io\/center\/recipes\//u,
      );
    }
  } finally {
    cleanupFetch();
  }
});

// ---------------------------------------------------------------------------
// #439 — sync progress ETA helpers
// ---------------------------------------------------------------------------

void test("formatSyncEtaMs formats remaining durations for sync progress", () => {
  assert.equal(sourceSyncInternals.formatSyncEtaMs(0), "~0s");
  assert.equal(sourceSyncInternals.formatSyncEtaMs(999), "~1s");
  assert.equal(sourceSyncInternals.formatSyncEtaMs(52_000), "~52s");
  assert.equal(sourceSyncInternals.formatSyncEtaMs(125_000), "~2m 5s");
  assert.equal(sourceSyncInternals.formatSyncEtaMs(180_000), "~3m");
  assert.equal(sourceSyncInternals.formatSyncEtaMs(3_600_000), "~60m");
  assert.equal(sourceSyncInternals.formatSyncEtaMs(-5), "~0s");
  assert.equal(sourceSyncInternals.formatSyncEtaMs(Number.NaN), "~0s");
  assert.equal(
    sourceSyncInternals.formatSyncEtaMs(Number.POSITIVE_INFINITY),
    "~0s",
  );
});

void test("estimateRemainingSyncMs extrapolates average per-source duration", () => {
  const past = Date.now() - 10_000;
  // 2 sources completed in 10s → ~5s/source; 5 remaining → ~25s.
  const remaining = sourceSyncInternals.estimateRemainingSyncMs(past, 2, 7);
  assert.ok(remaining > 20_000 && remaining < 30_000);

  // Nothing remaining (or nothing completed) → zero.
  assert.equal(
    sourceSyncInternals.estimateRemainingSyncMs(Date.now(), 2, 2),
    0,
  );
  assert.equal(
    sourceSyncInternals.estimateRemainingSyncMs(Date.now(), 0, 5),
    0,
  );
  assert.equal(
    sourceSyncInternals.estimateRemainingSyncMs(Date.now(), 3, 1),
    0,
  );
});
