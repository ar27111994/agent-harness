import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildArdUrn,
  deriveArdTrustManifest,
  ardCatalogInternals,
  extractErrorMessage,
  mapEntryToArd,
  resolveArdUpdatedAt,
  writeArdCatalog,
  type ArdCatalog,
} from "../ard-catalog.js";
import { ARD_SPEC_VERSION, getArdPublisherFqdn } from "../ard/types.js";
import type { AssetCatalogEntry } from "../types.js";

void test("ARD URNs use the current urn:air namespace and public identifier grammar", () => {
  const urn = buildArdUrn(entry(), "Example.COM");
  assert.match(urn, /^urn:air:example\.com:[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/u);
  assert.doesNotMatch(urn, /^urn:ai:/u);
});

void test("ARD mapping emits exactly one of url or data and keeps round-trip metadata", () => {
  const urlBacked = mapEntryToArd(entry(), "ar27111994.dev", "2.1.0");
  assert.equal(urlBacked.url, "https://example.com/skill");
  assert.equal("data" in urlBacked, false);
  assert.deepEqual(urlBacked.metadata, {
    assetKind: "skill",
    sourceId: "fixture-source",
    compatibilityMode: "native",
  });
  assert.ok((urlBacked.representativeQueries?.length ?? 0) >= 2);
  assert.ok((urlBacked.representativeQueries?.length ?? 0) <= 5);

  const inline = mapEntryToArd(
    entry({
      source: {
        ...entry().source,
        originUrl: "not-a-uri",
      },
    }),
    "ar27111994.dev",
    "2.1.0",
  );
  assert.equal("url" in inline, false);
  assert.deepEqual(inline.data, {
    assetKind: "skill",
    sourceId: "fixture-source",
    compatibilityMode: "native",
    manifestEntry: "skills/fixture/SKILL.md",
  });
});

void test("ARD trust manifests use a schema-valid HTTPS identity and do not invent attestations", () => {
  const manifest = deriveArdTrustManifest(entry());
  assert.deepEqual(manifest, {
    identity: `https://${getArdPublisherFqdn()}`,
    identityType: "https",
  });

  const untrusted = entry({
    source: {
      ...entry().source,
      authorityTier: "unverified-community",
      publisherVerified: false,
    },
    trust: { score: 10, signals: [] },
  });
  assert.equal(deriveArdTrustManifest(untrusted), undefined);
});

void test("invalid and epoch update timestamps are omitted", () => {
  assert.equal(
    resolveArdUpdatedAt(
      entry({ maintenance: { ...entry().maintenance, lastUpdated: "" } }),
    ),
    undefined,
  );
  assert.equal(
    resolveArdUpdatedAt(
      entry({
        maintenance: {
          ...entry().maintenance,
          lastUpdated: "1970-01-01T00:00:00.000Z",
        },
      }),
    ),
    undefined,
  );
  assert.equal(
    resolveArdUpdatedAt(
      entry({
        maintenance: {
          ...entry().maintenance,
          lastUpdated: "2026-08-01T12:00:00Z",
        },
      }),
    ),
    "2026-08-01T12:00:00.000Z",
  );
});

void test("checked-in ARD catalog contains no epoch-dated legacy entries", async () => {
  const catalog = JSON.parse(
    await readFile(
      join(process.cwd(), ".well-known", "ai-catalog.json"),
      "utf8",
    ),
  ) as ArdCatalog;
  const epochLegacyEntries = catalog.entries.filter(
    (item) =>
      item.identifier.includes(":legacy:") &&
      item.updatedAt === "1970-01-01T00:00:00.000Z",
  );
  assert.deepEqual(epochLegacyEntries, []);
});

void test("ARD mapping helpers cover safe fallbacks and inline metadata", () => {
  const { resolveHttpUrl, sanitizePublisherFqdn, sanitizeUrnSegment } =
    ardCatalogInternals;

  assert.equal(sanitizePublisherFqdn("!!!"), "agent-harness.local");
  assert.equal(sanitizeUrnSegment("!!!", "fallback"), "fallback");
  assert.equal(resolveHttpUrl(undefined), undefined);
  assert.equal(resolveHttpUrl("ftp://example.com/catalog"), undefined);
  assert.equal(resolveHttpUrl("not-a-url"), undefined);

  const mapped = mapEntryToArd(
    {
      ...entry(),
      assetKind: "future-kind" as unknown as AssetCatalogEntry["assetKind"],
      hosts: [],
      source: { ...entry().source, originUrl: "local-only" },
      install: { ...entry().install, manifestEntry: undefined },
    },
    "!!!",
    "2.1.0",
  );

  assert.equal(mapped.type, "application/ai-skill");
  assert.deepEqual(mapped.data, {
    assetKind: "future-kind",
    sourceId: "fixture-source",
    compatibilityMode: "native",
    manifestEntry: null,
  });
  assert.match(mapped.identifier, /agent-harness\.local/u);
});

void test("writeArdCatalog skips malformed catalog entries and falls back to an unknown package version", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-ard-edge-"));
  try {
    const { writeJsonLinesFile } = await import("../files.js");
    const malformed = {
      ...entry({ id: "malformed" }),
      capabilities: undefined,
    } as unknown as AssetCatalogEntry;
    const malformedWithDisplayName = {
      ...entry({ id: "", displayName: "Named malformed" }),
      capabilities: undefined,
    } as unknown as AssetCatalogEntry;
    const malformedWithoutIdentity = {
      ...entry({ id: "", displayName: "" }),
      capabilities: undefined,
    } as unknown as AssetCatalogEntry;
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [
        malformed,
        malformedWithDisplayName,
        malformedWithoutIdentity,
        entry({ id: "valid" }),
      ],
    );
    await writeFile(join(projectRoot, "package.json"), "{}", "utf8");

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) =>
      warnings.push(args.map(String).join(" "));
    try {
      const result = await writeArdCatalog(
        projectRoot,
        undefined,
        async (raw) => raw,
      );
      assert.equal(result.entryCount, 1);
      const catalog = JSON.parse(
        await readFile(result.filePath, "utf8"),
      ) as ArdCatalog;
      assert.equal(catalog.entries[0]?.version, "0.0.0");
      assert.match(warnings.join("\n"), /skipping malformed entry/u);
    } finally {
      console.warn = originalWarn;
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("writeArdCatalog emits a canonical generated catalog that validates against the vendored public schema", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-ard-v1-"));
  try {
    await import("../files.js").then(({ writeJsonLinesFile }) =>
      writeJsonLinesFile(
        join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
        [
          entry(),
          entry({
            id: "fixture-inline",
            displayName: "Inline Fixture",
            source: { ...entry().source, originUrl: "local-only" },
          }),
        ],
      ),
    );
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "agent-harness", version: "2.1.0" }),
      "utf8",
    );

    const result = await writeArdCatalog(projectRoot);
    assert.equal(result.entryCount, 2);
    const catalog = JSON.parse(
      await readFile(result.filePath, "utf8"),
    ) as ArdCatalog;
    assert.equal(catalog.specVersion, ARD_SPEC_VERSION);
    assert.equal(catalog.host?.displayName, "Agent Harness");
    assert.deepEqual(Object.keys(catalog).sort(), [
      "entries",
      "host",
      "specVersion",
    ]);
    assert.ok(
      catalog.entries.every((item) => item.identifier.startsWith("urn:air:")),
    );
    assert.ok(
      catalog.entries.every(
        (item) => Number("url" in item) + Number("data" in item) === 1,
      ),
    );

    const { validateArdCatalogFile, validateJsonSchema } =
      await import("../../scripts/validate-ard-schema.mjs");
    const schemaPath = join(
      process.cwd(),
      "discover",
      "schema",
      "ard-ai-catalog-1.0.schema.json",
    );
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(validateJsonSchema(catalog, schema), []);
    assert.deepEqual(
      await validateArdCatalogFile(result.filePath, schemaPath),
      [],
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("the dependency-free ARD schema validator reports core schema failures", async () => {
  const { validateJsonSchema } =
    await import("../../scripts/validate-ard-schema.mjs");
  assert.deepEqual(validateJsonSchema(null, { type: "null" }), []);
  assert.ok(
    validateJsonSchema("future", { type: "future-type" }).some((error) =>
      /unknown schema type/u.test(error),
    ),
  );
  assert.deepEqual(
    validateJsonSchema("value", 42 as unknown as Record<string, unknown>).some(
      (error) => /schema node must be an object/u.test(error),
    ),
    true,
  );
  assert.ok(
    validateJsonSchema("value", { $ref: "external-schema" }).some((error) =>
      /unresolved schema reference/u.test(error),
    ),
  );
  const errors = validateJsonSchema(
    {
      ref: "value",
      oneOf: true,
      wrongType: 42,
      enum: "unexpected",
      pattern: "not-ok",
    },
    {
      type: "object",
      properties: {
        ref: { $ref: "#/$defs/missing" },
        oneOf: { oneOf: [{ type: "string" }, { type: "number" }] },
        wrongType: { type: "string" },
        enum: { enum: ["ok"] },
        pattern: { type: "string", pattern: "^ok$" },
      },
      $defs: {},
    },
  );

  assert.ok(errors.some((error) => /unresolved schema reference/u.test(error)));
  assert.ok(
    errors.some((error) => /expected exactly one oneOf branch/u.test(error)),
  );
  assert.ok(errors.some((error) => /expected type "string"/u.test(error)));
  assert.ok(errors.some((error) => /value is not in enum/u.test(error)));
  assert.ok(errors.some((error) => /does not match pattern/u.test(error)));

  const constraintErrors = validateJsonSchema(
    { schemaVersion: "", count: -1, duplicateRate: 1.5 },
    {
      type: "object",
      properties: {
        schemaVersion: { type: "string", const: "1.0", minLength: 3 },
        count: { type: "integer", minimum: 0 },
        duplicateRate: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  );
  assert.ok(
    constraintErrors.some((error) => /does not equal const/u.test(error)),
  );
  assert.ok(
    constraintErrors.some((error) =>
      /expected at least 3 characters/u.test(error),
    ),
  );
  assert.ok(
    constraintErrors.some((error) => /expected number >= 0/u.test(error)),
  );
  assert.ok(
    constraintErrors.some((error) => /expected number <= 1/u.test(error)),
  );
  assert.ok(
    validateJsonSchema(
      {},
      { type: "object", properties: { broken: { type: "unknown" } } },
    ).some((error) => /unknown schema type/u.test(error)),
  );
  assert.ok(
    validateJsonSchema(
      "value",
      false as unknown as Record<string, unknown>,
    ).some((error) => /schema rejected value/u.test(error)),
  );
  assert.deepEqual(
    validateJsonSchema("value", null as unknown as Record<string, unknown>),
    [],
  );
  const cyclicSchema: Record<string, unknown> = { type: "object" };
  cyclicSchema.$defs = { self: cyclicSchema };
  assert.deepEqual(validateJsonSchema({}, cyclicSchema), []);
  assert.deepEqual(validateJsonSchema(["value"], { const: ["value"] }), []);
  assert.ok(
    validateJsonSchema(["value"], { const: "value" }).some((error) =>
      /does not equal const/u.test(error),
    ),
  );
  assert.deepEqual(
    validateJsonSchema({ key: "value" }, { const: { key: "value" } }),
    [],
  );
  assert.ok(
    validateJsonSchema({ key: "value" }, { const: "other" }).some((error) =>
      /does not equal const/u.test(error),
    ),
  );
  // minLength counts Unicode code points, not UTF-16 code units: an emoji is
  // one logical character despite occupying two code units (review / CodeRabbit).
  assert.ok(
    validateJsonSchema("😀", { type: "string", minLength: 2 }).some((error) =>
      /expected at least 2 characters/u.test(error),
    ),
    "an emoji is ONE code point and must fail minLength: 2",
  );
  assert.deepEqual(
    validateJsonSchema("😀", { type: "string", minLength: 1 }),
    [],
  );
});

void test("the dependency-free ARD schema validator covers collection and format constraints", async () => {
  const { validateJsonSchema } =
    await import("../../scripts/validate-ard-schema.mjs");
  const errors = validateJsonSchema(
    {
      uri: "not a uri",
      dateTime: "not a date-time",
      values: [1, 1],
      attributes: { count: "not-an-integer" },
      unexpected: true,
    },
    {
      type: "object",
      properties: {
        uri: { type: "string", format: "uri" },
        dateTime: { type: "string", format: "date-time" },
        values: {
          type: "array",
          minItems: 3,
          maxItems: 1,
          uniqueItems: true,
          items: { type: "number" },
        },
        attributes: {
          type: "object",
          properties: { label: { type: "string" } },
          additionalProperties: { type: "integer" },
        },
      },
      additionalProperties: false,
    },
  );

  assert.ok(errors.some((error) => /expected URI/u.test(error)));
  assert.ok(errors.some((error) => /expected RFC3339 date-time/u.test(error)));
  assert.ok(errors.some((error) => /expected at least 3 items/u.test(error)));
  assert.ok(errors.some((error) => /expected at most 1 items/u.test(error)));
  assert.ok(errors.some((error) => /expected unique items/u.test(error)));
  assert.ok(errors.some((error) => /expected type "integer"/u.test(error)));
  assert.ok(
    errors.some((error) => /unexpected property unexpected/u.test(error)),
  );
});

void test("the ARD schema validator direct entrypoint validates the canonical catalog", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const scriptPath = join(process.cwd(), "scripts", "validate-ard-schema.mjs");
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [scriptPath],
    { cwd: process.cwd() },
  );
  assert.match(`${stdout}${stderr}`, /ARD schema validation passed:/u);

  const explicitCatalog = join(process.cwd(), ".well-known", "ai-catalog.json");
  const explicitRun = await promisify(execFile)(
    process.execPath,
    [scriptPath, explicitCatalog],
    { cwd: process.cwd() },
  );
  assert.match(
    `${explicitRun.stdout}${explicitRun.stderr}`,
    /ARD schema validation passed:/u,
  );

  const invalidRoot = await mkdtemp(join(tmpdir(), "agent-harness-ard-cli-"));
  try {
    const invalidCatalog = join(invalidRoot, "invalid.json");
    await writeFile(invalidCatalog, "{}", "utf8");
    await assert.rejects(
      promisify(execFile)(process.execPath, [scriptPath, invalidCatalog], {
        cwd: process.cwd(),
      }),
      (error: unknown) => {
        const childError = error as {
          code?: number;
          stdout?: string;
          stderr?: string;
        };
        assert.equal(childError.code, 1);
        assert.match(
          `${childError.stdout ?? ""}${childError.stderr ?? ""}`,
          /ARD schema validation failed/u,
        );
        return true;
      },
    );
  } finally {
    await rm(invalidRoot, { recursive: true, force: true });
  }
});

void test("writeArdCatalog remains valid when Prettier is unavailable", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ard-fallback-"),
  );
  try {
    await import("../files.js").then(({ writeJsonLinesFile }) =>
      writeJsonLinesFile(
        join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
        [entry()],
      ),
    );
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) =>
      warnings.push(args.map(String).join(" "));
    try {
      const result = await writeArdCatalog(projectRoot, "2.1.0", async () => {
        throw new Error("formatter unavailable");
      });
      const catalog = JSON.parse(
        await readFile(result.filePath, "utf8"),
      ) as ArdCatalog;
      assert.equal(catalog.specVersion, "1.0");
      assert.match(warnings.join("\n"), /formatter unavailable/u);
    } finally {
      console.warn = originalWarn;
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("extractErrorMessage safely handles Error, primitives, null, and undefined", () => {
  assert.equal(extractErrorMessage(new Error("boom")), "boom");
  assert.equal(extractErrorMessage("plain"), "plain");
  assert.equal(extractErrorMessage(42), "42");
  assert.equal(extractErrorMessage(null), "unknown error");
  assert.equal(extractErrorMessage(undefined), "unknown error");
});

function entry(overrides: Partial<AssetCatalogEntry> = {}): AssetCatalogEntry {
  const base: AssetCatalogEntry = {
    id: "fixture.skill",
    displayName: "Fixture Skill",
    assetKind: "skill",
    hosts: ["codex"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 80,
      originUrl: "https://example.com/skill",
      publisher: "Fixture Publisher",
      publisherVerified: true,
    },
    trust: { score: 80, signals: ["publisher-verified"] },
    capabilities: ["testing", "typescript", "quality"],
    install: {
      method: "github-tree-metadata",
      manifestEntry: "skills/fixture/SKILL.md",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: "2026-08-01T12:00:00.000Z",
      stars: 3,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 0.8, hostFit: 1 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
  return { ...base, ...overrides };
}
