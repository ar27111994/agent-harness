import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMarkdownMetadata,
  getFirstStringField,
} from "../domains/discovery/markdown-metadata.js";

void test("markdown metadata parses supported frontmatter fields and prerequisites", () => {
  const metadata = extractMarkdownMetadata(`---
name: Repo Guide
unsupported: should-be-ignored

description: "Frontmatter description"
tags:
  - docs
  - "playbooks"
dependencies: ["node", "typescript"]
auth: ["github", "custom-auth"]
requiresEnv:
  - OPENAI_API_KEY
requiresHostLogin:
  - cursor
requiresOAuth:
  - slack
setupUrl: https://example.com/setup
---
# Ignored heading

Primary body sentence.
`);

  assert.equal(metadata.heading, "Ignored heading");
  assert.equal(metadata.description, "Frontmatter description");
  assert.deepEqual(metadata.tags, ["docs", "playbooks"]);
  assert.deepEqual(metadata.dependencies, ["node", "typescript"]);
  assert.deepEqual(metadata.authProviders, ["github", "custom-auth"]);
  assert.deepEqual(metadata.requiredEnvVars, ["OPENAI_API_KEY"]);
  assert.deepEqual(metadata.setupUrls, ["https://example.com/setup"]);
  assert.ok(!Object.hasOwn(metadata.fields, "unsupported"));
  assert.equal(metadata.lineCount, 22);
  assert.match(metadata.body, /^# Ignored heading/u);
  assert.deepEqual(
    metadata.prerequisites
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        provider: entry.provider,
        envVars: entry.envVars,
        host: entry.host,
        setupUrl: entry.setupUrl,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: "auth:custom-auth",
        kind: "manual",
        provider: "custom-auth",
        envVars: undefined,
        host: undefined,
        setupUrl: "https://example.com/setup",
      },
      {
        id: "auth:github",
        kind: "env",
        provider: "github",
        envVars: ["GITHUB_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN"],
        host: undefined,
        setupUrl: "https://example.com/setup",
      },
      {
        id: "env:OPENAI_API_KEY",
        kind: "env",
        provider: undefined,
        envVars: ["OPENAI_API_KEY"],
        host: undefined,
        setupUrl: undefined,
      },
      {
        id: "host-login:cursor",
        kind: "host-login",
        provider: undefined,
        envVars: undefined,
        host: "cursor",
        setupUrl: "https://example.com/setup",
      },
      {
        id: "oauth:slack",
        kind: "oauth",
        provider: "slack",
        envVars: undefined,
        host: undefined,
        setupUrl: "https://example.com/setup",
      },
    ],
  );
});

void test("markdown metadata falls back to body text when description is absent", () => {
  const metadata = extractMarkdownMetadata(`---
name: Example
---
<!-- generated -->
# Example heading

**Status:** Preview

This sentence should become the description.
More detail follows.
`);

  assert.equal(metadata.heading, "Example heading");
  assert.equal(
    metadata.description,
    "This sentence should become the description.",
  );
  assert.deepEqual(metadata.tags, []);
  assert.deepEqual(metadata.prerequisites, []);
});

void test("markdown metadata preserves content without frontmatter and first-string helper handles arrays", () => {
  const metadata = extractMarkdownMetadata(
    "# Plain heading\n\nPlain description.\n",
  );

  assert.deepEqual(metadata.fields, {});
  assert.equal(metadata.heading, "Plain heading");
  assert.equal(metadata.description, "Plain description.");
  assert.equal(getFirstStringField("value"), "value");
  assert.equal(getFirstStringField(""), null);
  assert.equal(getFirstStringField(["value"]), null);
  assert.equal(getFirstStringField(undefined), null);
});

void test("markdown metadata treats non-fence triple-dash prefixes as body content", () => {
  const metadata = extractMarkdownMetadata(`---not-frontmatter
# Plain heading
Plain description.
`);

  assert.deepEqual(metadata.fields, {});
  assert.equal(metadata.heading, "Plain heading");
  assert.equal(metadata.description, "---not-frontmatter");
  assert.match(metadata.body, /^---not-frontmatter/u);
});

void test("markdown metadata parses supported fields until EOF when a frontmatter fence is unterminated", () => {
  const metadata = extractMarkdownMetadata(`---
description: Draft description
tags:
  - draft
# Body-like heading
`);

  assert.deepEqual(metadata.tags, ["draft"]);
  assert.equal(metadata.heading, "Body-like heading");
  assert.equal(metadata.description, "Draft description");
  assert.match(metadata.body, /^description: Draft description/u);
});
