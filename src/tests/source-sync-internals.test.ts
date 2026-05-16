import assert from "node:assert/strict";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import type { SourceSyncSourceState } from "../domains/discovery/source-sync.js";
import { sourceSyncInternals } from "../domains/discovery/source-sync.js";
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
      { cursorId: "react", nextToken: "7", completed: true },
      { cursorId: "react", nextToken: "1", completed: false },
    ),
    { cursorId: "react", nextToken: "1", completed: false },
  );

  assert.equal(sourceSyncInternals.parsePositiveIntegerToken("5", 1), 5);
  assert.equal(sourceSyncInternals.parsePositiveIntegerToken("0", 1), 1);
  assert.equal(sourceSyncInternals.parsePositiveIntegerToken(undefined, 2), 2);
  assert.equal(sourceSyncInternals.parseNonNegativeIntegerToken("0", 1), 0);
  assert.equal(sourceSyncInternals.parseNonNegativeIntegerToken("-1", 1), 1);

  assert.equal(sourceSyncInternals.stringifyUnknown("text"), "text");
  assert.equal(sourceSyncInternals.stringifyUnknown(42), "42");
  assert.equal(sourceSyncInternals.stringifyUnknown(Number.NaN), undefined);
  assert.equal(sourceSyncInternals.getErrorMessage(new Error("boom")), "boom");
  assert.equal(sourceSyncInternals.getErrorMessage(404), "404");
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
      case "https://replicate.npmjs.com/_changes?since=7&limit=50":
        return jsonResponse({
          last_seq: { unsupported: true },
          results: [
            { id: "deleted-pkg", deleted: true },
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
      case "https://index.golang.org/index?since=1970-01-01T00%3A00%3A00Z&limit=50":
        return textResponse(
          [
            '{"bad":',
            '{"Timestamp":"2026-05-08T00:00:00Z"}',
            '{"Path":"github.com/acme/go-agent"}',
          ].join("\n"),
        );
      case "https://search.maven.org/solrsearch/select?q=*%3A*&rows=50&start=0&wt=json":
        return jsonResponse({
          response: {
            docs: [{ g: "com.acme" }, { g: "com.acme", a: "agent-core" }],
          },
        });
      case "https://api.nuget.org/v3/query?q=&skip=0&take=50&prerelease=true&semVerLevel=2.0.0":
        return jsonResponse({
          data: [{ description: "missing id" }, { id: "Acme.AgentTools" }],
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
        assert.equal(goResult.cursors[0]?.nextToken, "1970-01-01T00:00:00Z");
        assert.equal(goContext.entriesById.size, 1);

        const mavenContext = buildSourceSyncContext();
        const mavenResult = await sourceSyncInternals.syncMavenRegistrySource(
          buildSourceDefinition("maven-registry", "package-registry", {
            baseUrl: "https://central.sonatype.com",
          }),
          mavenContext,
        );
        assert.equal(mavenResult.status, "complete");
        assert.equal(mavenContext.entriesById.size, 1);

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
      case "https://example.com/root.xml":
        return xmlResponse([
          "<sitemapindex>",
          "<sitemap><loc>https://example.com/leaf.xml?x=1</loc></sitemap>",
          "<sitemap><loc>https://other.example/skip.xml</loc></sitemap>",
          "</sitemapindex>",
        ]);
      case "https://example.com/plain.xml":
        return xmlResponse(["<urlset></urlset>"]);
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
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input, init) => responder(input, init);

  return () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
      return;
    }
    process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
