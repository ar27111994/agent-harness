import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  collectDemandSignalsForFile,
  getDemandEvidenceStrength,
  isActorJsonFile,
  shouldInspectFile,
} from "../domains/discovery/demand-signals.js";

void test("demand signals classify inspectable files and ignore known non-demand docs", async () => {
  assert.equal(
    shouldInspectFile("pyproject.toml", "C:/repo/pyproject.toml"),
    true,
  );
  assert.equal(
    shouldInspectFile("actor.json", "C:/repo/.actor/actor.json"),
    true,
  );
  assert.equal(
    shouldInspectFile("CHANGELOG.md", "C:/repo/CHANGELOG.md"),
    false,
  );
  assert.equal(
    getDemandEvidenceStrength("roadmap.md", "C:/repo/roadmap.md"),
    null,
  );
  assert.equal(
    getDemandEvidenceStrength("notes.md", "C:/repo/docs/notes.md"),
    "weak",
  );
  assert.equal(
    isActorJsonFile("actor.json", "C:/repo/.actor/actor.json"),
    true,
  );
  assert.equal(isActorJsonFile("config.json", "C:/repo/config.json"), false);

  const ignoredSignals = await collectDemandSignalsForFile(
    "roadmap.md",
    "C:/repo/roadmap.md",
  );
  assert.deepEqual(ignoredSignals.languages, []);
});

void test("demand signals extract pyproject actor swift and gradle ecosystem signals from files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-signals-"));

  try {
    const pyprojectPath = join(root, "pyproject.toml");
    const actorPath = join(root, ".actor", "actor.json");
    const swiftPath = join(root, "Package.swift");
    const gradlePath = join(root, "android", "build.gradle.kts");

    await writeText(
      pyprojectPath,
      `[project]
      dependencies = [
        "fastapi>=0.100",
        "acme-tool @ file:../local"
      ]

      [project.optional-dependencies]
      dev = ["pytest>=8"]

      [tool.poetry.dependencies]
      python = "^3.12"
      httpx = "^0.27"
      localpkg = { path = "../pkg" }

      [tool.poetry.group.docs.dependencies]
      mkdocs = "^1.6"
      `,
    );
    await writeText(
      actorPath,
      JSON.stringify({
        title: "Webhook replay actor",
        description: "Provides mocking, integration, and logging help.",
        categories: ["WEB_AUTOMATION"],
        dockerfile: "./Dockerfile",
        webServerSchema: "openapi: 3.1.0",
      }),
    );
    await writeText(
      swiftPath,
      `// swift-tools-version: 5.9
      import PackageDescription
      let package = Package(
        name: "SwiftAgent",
        dependencies: [
          .package(url: "https://github.com/apple/swift-log.git", from: "1.0.0"),
          .package(url: "https://github.com/acme/swift-mcp.git", from: "1.0.0")
        ]
      )
      `,
    );
    await writeText(
      gradlePath,
      `plugins {
        id("com.android.application")
        kotlin("android")
      }
      dependencies {
        implementation("com.squareup.okhttp3:okhttp:4.12.0")
      }
      `,
    );

    const pyprojectSignals = await collectDemandSignalsForFile(
      "pyproject.toml",
      pyprojectPath,
    );
    const actorSignals = await collectDemandSignalsForFile(
      "actor.json",
      actorPath,
    );
    const swiftSignals = await collectDemandSignalsForFile(
      "Package.swift",
      swiftPath,
    );
    const gradleSignals = await collectDemandSignalsForFile(
      "build.gradle.kts",
      gradlePath,
    );

    assert.ok(pyprojectSignals.languages.includes("python"));
    assert.ok(pyprojectSignals.packageManagers.includes("pip"));
    assert.ok(pyprojectSignals.tooling.includes("pypi:fastapi"));
    assert.ok(pyprojectSignals.tooling.includes("pypi:pytest"));
    assert.ok(pyprojectSignals.tooling.includes("pypi:httpx"));
    assert.ok(pyprojectSignals.tooling.includes("pypi:mkdocs"));
    assert.ok(!pyprojectSignals.tooling.includes("pypi:acme-tool"));
    assert.ok(!pyprojectSignals.tooling.includes("pypi:localpkg"));

    assert.ok(actorSignals.concerns.includes("actor-development"));
    assert.ok(actorSignals.concerns.includes("automation"));
    assert.ok(actorSignals.concerns.includes("containerization"));
    assert.ok(actorSignals.concerns.includes("backend"));
    assert.ok(actorSignals.concerns.includes("webhook"));
    assert.ok(actorSignals.concerns.includes("replay"));
    assert.ok(actorSignals.concerns.includes("mocking"));
    assert.ok(actorSignals.concerns.includes("logging"));
    assert.ok(actorSignals.concerns.includes("integration"));
    assert.ok(actorSignals.tooling.includes("docker"));
    assert.ok(actorSignals.tooling.includes("actor-runtime"));
    assert.ok(actorSignals.tooling.includes("webhook"));

    assert.ok(swiftSignals.languages.includes("swift"));
    assert.ok(swiftSignals.packageManagers.includes("swiftpm"));
    assert.ok(
      swiftSignals.tooling.includes(
        "swift:https://github.com/apple/swift-log.git",
      ),
    );
    assert.ok(
      swiftSignals.tooling.includes(
        "swift:https://github.com/acme/swift-mcp.git",
      ),
    );

    assert.ok(gradleSignals.languages.includes("java"));
    assert.ok(gradleSignals.languages.includes("kotlin"));
    assert.ok(gradleSignals.concerns.includes("mobile"));
    assert.ok(gradleSignals.concerns.includes("android"));
    assert.ok(gradleSignals.tooling.includes("android-gradle"));
    assert.ok(
      gradleSignals.tooling.includes("maven:com.squareup.okhttp3:okhttp"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals cover additional static language and missing-content paths", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-demand-signals-extra-"),
  );

  try {
    const csharpSignals = await collectDemandSignalsForFile(
      "Program.cs",
      join(root, "Program.cs"),
    );
    const juliaSignals = await collectDemandSignalsForFile(
      "analysis.jl",
      join(root, "analysis.jl"),
    );
    const rubySignals = await collectDemandSignalsForFile(
      "app.rb",
      join(root, "app.rb"),
    );
    const missingRequirementsSignals = await collectDemandSignalsForFile(
      "requirements.txt",
      join(root, "requirements.txt"),
    );
    const invalidActorPath = join(root, ".actor", "actor.json");
    await writeText(invalidActorPath, "not-json");
    const invalidActorSignals = await collectDemandSignalsForFile(
      "actor.json",
      invalidActorPath,
    );

    assert.ok(csharpSignals.languages.includes("csharp"));
    assert.ok(juliaSignals.languages.includes("julia"));
    assert.ok(rubySignals.languages.includes("ruby"));
    assert.deepEqual(missingRequirementsSignals.tooling, []);
    assert.ok(invalidActorSignals.concerns.includes("actor-development"));
    assert.ok(invalidActorSignals.tooling.includes("actor-runtime"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

void test("node-cli framework signal is emitted for package.json with bin field and node engine", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-node-cli-signal-"));
  try {
    const pkgPath = join(root, "package.json");

    // Case 1: bin as object + engines.node → should emit node-cli
    await writeText(
      pkgPath,
      JSON.stringify({
        name: "my-cli-tool",
        bin: { "my-cli": "./bin/cli.js" },
        engines: { node: ">=18" },
      }),
    );
    const withBinObject = await collectDemandSignalsForFile(
      "package.json",
      pkgPath,
    );
    assert.ok(
      withBinObject.frameworks.includes("node-cli"),
      "expected node-cli for bin object + engines.node",
    );

    // Case 2: bin as string + engines.node → should emit node-cli
    await writeText(
      pkgPath,
      JSON.stringify({
        name: "my-cli-tool",
        bin: "./bin/cli.js",
        engines: { node: ">=18" },
      }),
    );
    const withBinString = await collectDemandSignalsForFile(
      "package.json",
      pkgPath,
    );
    assert.ok(
      withBinString.frameworks.includes("node-cli"),
      "expected node-cli for bin string + engines.node",
    );

    // Case 3: bin present but no engines.node → must NOT emit node-cli
    await writeText(
      pkgPath,
      JSON.stringify({
        name: "my-lib",
        bin: { "my-cli": "./bin/cli.js" },
      }),
    );
    const noBinWithoutEngines = await collectDemandSignalsForFile(
      "package.json",
      pkgPath,
    );
    assert.ok(
      !noBinWithoutEngines.frameworks.includes("node-cli"),
      "must not emit node-cli without engines.node",
    );

    // Case 4: engines.node present but no bin → must NOT emit node-cli
    await writeText(
      pkgPath,
      JSON.stringify({
        name: "my-lib",
        engines: { node: ">=18" },
        dependencies: { express: "^4" },
      }),
    );
    const noCliWithoutBin = await collectDemandSignalsForFile(
      "package.json",
      pkgPath,
    );
    assert.ok(
      !noCliWithoutBin.frameworks.includes("node-cli"),
      "must not emit node-cli without bin field",
    );

    // Case 5: bin is empty object → must NOT emit node-cli
    await writeText(
      pkgPath,
      JSON.stringify({
        name: "my-lib",
        bin: {},
        engines: { node: ">=18" },
      }),
    );
    const emptyBin = await collectDemandSignalsForFile("package.json", pkgPath);
    assert.ok(
      !emptyBin.frameworks.includes("node-cli"),
      "must not emit node-cli for empty bin object",
    );

    // Case 6: tooling always includes "node" when engines.node is set
    await writeText(
      pkgPath,
      JSON.stringify({ name: "app", engines: { node: ">=16" } }),
    );
    const nodeTooling = await collectDemandSignalsForFile(
      "package.json",
      pkgPath,
    );
    assert.ok(
      nodeTooling.tooling.includes("node"),
      "expected tooling.node for engines.node",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
