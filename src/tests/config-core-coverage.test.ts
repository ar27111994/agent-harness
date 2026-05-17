import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearRuntimeConfigForTests,
  getRuntimeConfig,
  loadRuntimeConfig,
} from "../config/runtime.js";
import { envFileInternals, loadDotEnvFile } from "../config/env-file.js";

void test("dotenv loader returns an unloaded result when the file is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-env-missing-"));

  try {
    const env: NodeJS.ProcessEnv = {};
    const result = await loadDotEnvFile(root, env);

    assert.equal(result.loaded, false);
    assert.deepEqual(result.appliedKeys, []);
    assert.equal(result.path, join(root, ".env"));
    assert.deepEqual(env, {});
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("dotenv loader parses comments continuations CRLF and quoted escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-env-parse-"));

  try {
    await writeFile(
      join(root, ".env"),
      [
        "# ignored comment\r",
        "INVALID-KEY=value\r",
        "PLAIN=alpha # inline comment\r",
        'DOUBLE="line\\nquote\\"tab\\tunknown\\q"\r',
        "SINGLE='literal\\nvalue'\r",
        'MULTILINE="line one\r',
        'line two"\r',
        "CONTINUED=first\\\r",
        "   second\r",
        "export EXPORTED = spaced\r",
        "PLAIN=omega\r",
        "",
      ].join("\n"),
      "utf8",
    );

    const env: NodeJS.ProcessEnv = {};
    const result = await loadDotEnvFile(root, env);

    assert.equal(result.loaded, true);
    assert.deepEqual(result.appliedKeys, [
      "PLAIN",
      "DOUBLE",
      "SINGLE",
      "MULTILINE",
      "CONTINUED",
      "EXPORTED",
    ]);
    assert.equal(env.PLAIN, "omega");
    assert.equal(env.DOUBLE, 'line\nquote"tab\tunknown\\q');
    assert.equal(env.SINGLE, "literal\\nvalue");
    assert.equal(env.MULTILINE, "line one\nline two");
    assert.equal(env.CONTINUED, "first  second");
    assert.equal(env.EXPORTED, "spaced");
    assert.equal(env["INVALID-KEY"], undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("dotenv loader rejects unterminated quoted values", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-env-error-"));

  try {
    await writeFile(join(root, ".env"), 'BROKEN="unterminated\n', "utf8");

    await assert.rejects(
      loadDotEnvFile(root, {}),
      /Unterminated quoted value in \.env file\./u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("dotenv internals preserve non-whitespace continuation starts", () => {
  assert.deepEqual(
    envFileInternals.collectDotEnvLogicalLines("JOINED=one\\\ntwo"),
    ["JOINED=onetwo"],
  );
  assert.deepEqual(envFileInternals.parseDotEnvLine("JOINED=one\\\ntwo"), [
    "JOINED",
    "one\\\ntwo",
  ]);
});

void test("runtime config falls back through home env sources and normalizes origins", () => {
  const config = loadRuntimeConfig({
    AGENT_HARNESS_HOME: "   ",
    HOME: "   ",
    USERPROFILE: "C:/Users/tester",
    GITHUB_TOKEN: "fallback-token",
    GITHUB_PERSONAL_ACCESS_TOKEN: "preferred-token",
    AGENT_HARNESS_AI_ENRICHMENT_URL:
      "https://gateway.example.com/v1/chat/completions",
    AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS: [
      " https://proxy.example.com ",
      "https://gateway.example.com/extra",
      "https://proxy.example.com",
    ].join(",\n"),
    AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT: "7",
    AGENT_HARNESS_ZED_RECOMMENDATION_LIMIT_MODE: "preserve",
    AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS: "0",
    AGENT_HARNESS_AI_ENRICHMENT_ALLOW_CACHE_IN_CI: "off",
    AGENT_HARNESS_AI_ENRICHMENT_REQUIRE_SUCCESS_IN_CI: "yes",
  });

  assert.equal(config.paths.homeDirectory, "C:/Users/tester");
  assert.equal(config.github.token, "preferred-token");
  assert.deepEqual(config.aiEnrichment.allowedOrigins, [
    "https://api.openai.com",
    "https://openrouter.ai",
    "https://api.groq.com",
    "https://api.mistral.ai",
    "https://api.deepseek.com",
    "https://api.x.ai",
    "https://api.perplexity.ai",
    "https://api.fireworks.ai",
    "https://api.together.xyz",
    "https://proxy.example.com",
    "https://gateway.example.com",
  ]);
  assert.equal(config.aiEnrichment.retryBackoffMs, 0);
  assert.equal(config.aiEnrichment.allowCacheInCi, false);
  assert.equal(config.aiEnrichment.requireSuccessInCi, true);
  assert.equal(config.recommendation.limitOverrides.shared?.value, 7);
  assert.equal(config.recommendation.limitOverrideModes.zed?.value, "preserve");
});

void test("runtime config ignores invalid or non-https enrichment origins from the endpoint URL", () => {
  const insecureConfig = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_AI_ENRICHMENT_URL:
      "http://gateway.example.com/v1/chat/completions",
  });
  const malformedConfig = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_AI_ENRICHMENT_URL: "not-a-url",
  });

  assert.deepEqual(
    insecureConfig.aiEnrichment.allowedOrigins.filter(
      (origin) => new URL(origin).protocol !== "https:",
    ),
    [],
  );
  assert.deepEqual(
    malformedConfig.aiEnrichment.allowedOrigins.filter((origin) => {
      try {
        new URL(origin);
        return false;
      } catch {
        return true;
      }
    }),
    [],
  );
});

void test("runtime config caches process env until explicitly cleared", () => {
  const previousHome = process.env.AGENT_HARNESS_HOME;
  const previousDebug = process.env.AGENT_HARNESS_DEBUG;

  try {
    process.env.AGENT_HARNESS_HOME = "/cached-home";
    process.env.AGENT_HARNESS_DEBUG = "false";
    clearRuntimeConfigForTests();

    const firstConfig = getRuntimeConfig();

    process.env.AGENT_HARNESS_HOME = "/updated-home";
    process.env.AGENT_HARNESS_DEBUG = "true";

    const cachedConfig = getRuntimeConfig();
    assert.equal(cachedConfig.paths.homeDirectory, "/cached-home");
    assert.equal(cachedConfig.diagnostics.debugEnabled, false);
    assert.equal(firstConfig, cachedConfig);

    clearRuntimeConfigForTests();
    const refreshedConfig = getRuntimeConfig();
    assert.equal(refreshedConfig.paths.homeDirectory, "/updated-home");
    assert.equal(refreshedConfig.diagnostics.debugEnabled, true);
  } finally {
    restoreEnv("AGENT_HARNESS_HOME", previousHome);
    restoreEnv("AGENT_HARNESS_DEBUG", previousDebug);
    clearRuntimeConfigForTests();
  }
});

void test("runtime config rejects invalid additional numeric knobs", () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS: "-1",
      }),
    /AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS must be a non-negative integer/u,
  );

  assert.throws(
    () =>
      loadRuntimeConfig({
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS:
          "https://ok.example.com,ftp://bad.example.com",
      }),
    /AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS/u,
  );
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
