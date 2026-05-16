/**
 * Targeted tests for demand-signals.ts coverage gaps:
 * - Language source file static signals (rust, go, c/cpp, erlang, elixir, julia, php, ruby, etc.)
 * - Lock file signals (pnpm, yarn, bun)
 * - Ecosystem-specific manifest signals (Cargo.toml, go.mod, Gemfile, composer.json, etc.)
 * - Dockerfile, compose, terraform signals
 * - openapi/swagger, vitest/jest config signals
 * - shouldInspectFile edge cases
 * - getDemandEvidenceStrength edge cases
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  collectDemandSignalsForFile,
  getDemandEvidenceStrength,
  shouldInspectFile,
} from "../domains/discovery/demand-signals.js";

void test("demand signals return strong evidence for language source files", () => {
  assert.equal(
    getDemandEvidenceStrength("main.rs", "/project/src/main.rs"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("lib.go", "/project/lib.go"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("util.cpp", "/project/util.cpp"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("handler.java", "/project/handler.java"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("types.cs", "/project/types.cs"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("parser.kt", "/project/parser.kt"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("view.swift", "/project/view.swift"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("module.ex", "/project/module.ex"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("module.exs", "/project/module.exs"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("src.erl", "/project/src.erl"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("model.jl", "/project/model.jl"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("controller.php", "/project/controller.php"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("helper.rb", "/project/helper.rb"),
    "strong",
  );
});

void test("demand signals shouldInspectFile accepts language source files", () => {
  assert.equal(shouldInspectFile("main.rs", "/project/src/main.rs"), true);
  assert.equal(shouldInspectFile("lib.go", "/project/lib.go"), true);
  assert.equal(shouldInspectFile("util.cpp", "/project/util.cpp"), true);
  assert.equal(
    shouldInspectFile("handler.java", "/project/handler.java"),
    true,
  );
  assert.equal(shouldInspectFile("model.ex", "/project/model.ex"), true);
});

void test("demand signals shouldInspectFile accepts nuget and terraform files", () => {
  assert.equal(
    shouldInspectFile("MyApp.csproj", "/project/MyApp.csproj"),
    true,
  );
  assert.equal(shouldInspectFile("infra.tf", "/project/infra.tf"), true);
  assert.equal(
    shouldInspectFile("terraform.tfvars", "/project/terraform.tfvars"),
    true,
  );
  assert.equal(shouldInspectFile("MyApp.sln", "/project/MyApp.sln"), true);
});

void test("demand signals shouldInspectFile accepts openapi and test config files", () => {
  assert.equal(
    shouldInspectFile("openapi.yaml", "/project/openapi.yaml"),
    true,
  );
  assert.equal(
    shouldInspectFile("swagger.json", "/project/swagger.json"),
    true,
  );
  assert.equal(
    shouldInspectFile("vitest.config.ts", "/project/vitest.config.ts"),
    true,
  );
  assert.equal(
    shouldInspectFile("jest.config.js", "/project/jest.config.js"),
    true,
  );
  assert.equal(
    shouldInspectFile("playwright.config.ts", "/project/playwright.config.ts"),
    true,
  );
});

void test("demand signals shouldInspectFile rejects ignored demand patterns", () => {
  assert.equal(
    shouldInspectFile("CHANGELOG.md", "/project/CHANGELOG.md"),
    false,
  );
  assert.equal(
    shouldInspectFile("CONTRIBUTING.md", "/project/CONTRIBUTING.md"),
    false,
  );
  assert.equal(shouldInspectFile("roadmap.md", "/project/roadmap.md"), false);
  assert.equal(
    shouldInspectFile(
      "bug_report.md",
      "/project/.github/ISSUE_TEMPLATE/bug_report.md",
    ),
    false,
  );
});

void test("demand signals shouldInspectFile accepts compose and docker files", () => {
  assert.equal(shouldInspectFile("Dockerfile", "/project/Dockerfile"), true);
  assert.equal(
    shouldInspectFile("Dockerfile.prod", "/project/Dockerfile.prod"),
    true,
  );
  assert.equal(
    shouldInspectFile("docker-compose.yml", "/project/docker-compose.yml"),
    true,
  );
  assert.equal(
    shouldInspectFile("compose.yaml", "/project/compose.yaml"),
    true,
  );
  assert.equal(
    shouldInspectFile("compose.yml", "/project/services/compose.yml"),
    true,
  );
});

void test("demand signals shouldInspectFile detects docker-compose via path pattern", () => {
  // Matches docker-compose. in path
  assert.equal(
    shouldInspectFile(
      "docker-compose.override.yml",
      "/project/docker-compose.override.yml",
    ),
    true,
  );
});

void test("demand signals extract static signals from lock files and manifest files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-static-"));

  try {
    const pnpmLockPath = join(root, "pnpm-lock.yaml");
    const yarnLockPath = join(root, "yarn.lock");
    const bunLockPath = join(root, "bun.lockb");
    const cargoTomlPath = join(root, "Cargo.toml");
    const goModPath = join(root, "go.mod");
    const gemfilePath = join(root, "Gemfile");
    const composerPath = join(root, "composer.json");
    const makefilePath = join(root, "Makefile");
    const podfilePath = join(root, "Podfile");
    const cmakePath = join(root, "CMakeLists.txt");
    const denoJsonPath = join(root, "deno.json");
    const dockerfilePath = join(root, "Dockerfile");
    const composePath = join(root, "compose.yaml");
    const openApiPath = join(root, "openapi.yaml");
    const vitestConfigPath = join(root, "vitest.config.ts");

    for (const filePath of [
      pnpmLockPath,
      yarnLockPath,
      bunLockPath,
      cargoTomlPath,
      goModPath,
      gemfilePath,
      composerPath,
      makefilePath,
      podfilePath,
      cmakePath,
      denoJsonPath,
      dockerfilePath,
      composePath,
      openApiPath,
      vitestConfigPath,
    ]) {
      await writeText(filePath, "# placeholder content\n");
    }

    const pnpmSignals = await collectDemandSignalsForFile(
      "pnpm-lock.yaml",
      pnpmLockPath,
    );
    const yarnSignals = await collectDemandSignalsForFile(
      "yarn.lock",
      yarnLockPath,
    );
    const bunSignals = await collectDemandSignalsForFile(
      "bun.lockb",
      bunLockPath,
    );
    const cargoSignals = await collectDemandSignalsForFile(
      "Cargo.toml",
      cargoTomlPath,
    );
    const goSignals = await collectDemandSignalsForFile("go.mod", goModPath);
    const gemSignals = await collectDemandSignalsForFile(
      "Gemfile",
      gemfilePath,
    );
    const composerSignals = await collectDemandSignalsForFile(
      "composer.json",
      composerPath,
    );
    const makeSignals = await collectDemandSignalsForFile(
      "Makefile",
      makefilePath,
    );
    const podSignals = await collectDemandSignalsForFile(
      "Podfile",
      podfilePath,
    );
    const cmakeSignals = await collectDemandSignalsForFile(
      "CMakeLists.txt",
      cmakePath,
    );
    const denoSignals = await collectDemandSignalsForFile(
      "deno.json",
      denoJsonPath,
    );
    const dockerSignals = await collectDemandSignalsForFile(
      "Dockerfile",
      dockerfilePath,
    );
    const composeSignals = await collectDemandSignalsForFile(
      "compose.yaml",
      composePath,
    );
    const openApiSignals = await collectDemandSignalsForFile(
      "openapi.yaml",
      openApiPath,
    );
    const vitestSignals = await collectDemandSignalsForFile(
      "vitest.config.ts",
      vitestConfigPath,
    );

    assert.ok(pnpmSignals.packageManagers.includes("pnpm"));
    assert.ok(yarnSignals.packageManagers.includes("yarn"));
    assert.ok(bunSignals.packageManagers.includes("bun"));

    assert.ok(cargoSignals.languages.includes("rust"));
    assert.ok(cargoSignals.packageManagers.includes("cargo"));

    assert.ok(goSignals.languages.includes("go"));
    assert.ok(goSignals.packageManagers.includes("go-modules"));

    assert.ok(gemSignals.languages.includes("ruby"));
    assert.ok(gemSignals.packageManagers.includes("bundler"));

    assert.ok(composerSignals.languages.includes("php"));
    assert.ok(composerSignals.packageManagers.includes("composer"));

    assert.ok(makeSignals.tooling.includes("make"));
    assert.ok(podSignals.concerns.includes("ios"));
    assert.ok(podSignals.packageManagers.includes("cocoapods"));
    assert.ok(cmakeSignals.tooling.includes("cmake"));
    assert.ok(denoSignals.tooling.includes("deno"));

    assert.ok(dockerSignals.tooling.includes("docker"));
    assert.ok(dockerSignals.concerns.includes("containerization"));
    assert.ok(composeSignals.tooling.includes("docker"));

    assert.ok(openApiSignals.tooling.includes("openapi"));
    assert.ok(openApiSignals.concerns.includes("openapi"));

    assert.ok(vitestSignals.tooling.includes("vitest"));
    assert.ok(vitestSignals.concerns.includes("testing"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals extract signals from Package.swift file content", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-swift-"));

  try {
    const swiftPath = join(root, "Package.swift");
    await writeText(
      swiftPath,
      `
import PackageDescription
let package = Package(
  name: "SwiftAgent",
  dependencies: [
    .package(url: "https://github.com/apple/swift-log.git", from: "1.0.0"),
  ]
)
`,
    );
    const signals = await collectDemandSignalsForFile(
      "Package.swift",
      swiftPath,
    );

    assert.ok(signals.languages.includes("swift"));
    assert.ok(signals.packageManagers.includes("swiftpm"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals extract signals from mix.exs and rebar.config", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-elixir-"));

  try {
    const mixPath = join(root, "mix.exs");
    const rebarPath = join(root, "rebar.config");
    await writeText(
      mixPath,
      `defmodule MyApp.MixProject do\n  def project, do: [app: :my_app]\nend`,
    );
    await writeText(rebarPath, `{erl_opts, [debug_info]}.`);

    const mixSignals = await collectDemandSignalsForFile("mix.exs", mixPath);
    const rebarSignals = await collectDemandSignalsForFile(
      "rebar.config",
      rebarPath,
    );

    assert.ok(mixSignals.languages.includes("elixir"));
    assert.ok(mixSignals.packageManagers.includes("hex"));
    assert.ok(rebarSignals.languages.includes("erlang"));
    assert.ok(rebarSignals.packageManagers.includes("rebar"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals extract signals from Julia toml files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-julia-"));

  try {
    const projectTomlPath = join(root, "Project.toml");
    const manifestTomlPath = join(root, "Manifest.toml");
    await writeText(
      projectTomlPath,
      `[deps]\nFlux = "587475ba-b771-5e3f-ad9e-33799f191a9c"`,
    );
    await writeText(manifestTomlPath, `manifest_format = "2.0"`);

    const projectSignals = await collectDemandSignalsForFile(
      "Project.toml",
      projectTomlPath,
    );
    const manifestSignals = await collectDemandSignalsForFile(
      "Manifest.toml",
      manifestTomlPath,
    );

    assert.ok(projectSignals.languages.includes("julia"));
    assert.ok(projectSignals.packageManagers.includes("julia-pkg"));
    assert.ok(manifestSignals.languages.includes("julia"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals extract android signals from AndroidManifest.xml and Podfile signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-mobile-"));

  try {
    const androidManifestPath = join(root, "AndroidManifest.xml");
    const infoPath = join(root, "Info.plist");
    await writeText(
      androidManifestPath,
      `<manifest xmlns:android="..." package="com.acme.app"></manifest>`,
    );
    await writeText(
      infoPath,
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"></plist>`,
    );

    const androidSignals = await collectDemandSignalsForFile(
      "AndroidManifest.xml",
      androidManifestPath,
    );
    const iosSignals = await collectDemandSignalsForFile(
      "Info.plist",
      infoPath,
    );

    assert.ok(androidSignals.concerns.includes("android"));
    assert.ok(androidSignals.tooling.includes("android"));
    assert.ok(iosSignals.concerns.includes("ios"));
    assert.ok(iosSignals.tooling.includes("xcode"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals extract signals from terraform files via static signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-tf-"));

  try {
    const tfPath = join(root, "main.tf");
    const tfvarsPath = join(root, "terraform.tfvars");
    await writeText(
      tfPath,
      `provider "aws" {}\nresource "aws_s3_bucket" "b" {}`,
    );
    await writeText(tfvarsPath, `region = "us-east-1"`);

    const tfSignals = await collectDemandSignalsForFile("main.tf", tfPath);
    const tfvarsSignals = await collectDemandSignalsForFile(
      "terraform.tfvars",
      tfvarsPath,
    );

    assert.ok(tfSignals.tooling.includes("terraform"));
    assert.ok(tfSignals.concerns.includes("infrastructure"));
    assert.ok(tfvarsSignals.tooling.includes("terraform"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals extract jest config and playwright signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-test-"));

  try {
    const jestPath = join(root, "jest.config.js");
    const playwrightPath = join(root, "playwright.config.ts");
    await writeText(jestPath, `module.exports = { testEnvironment: "jsdom" };`);
    await writeText(playwrightPath, `export default { testDir: "./tests" };`);

    const jestSignals = await collectDemandSignalsForFile(
      "jest.config.js",
      jestPath,
    );
    const playwrightSignals = await collectDemandSignalsForFile(
      "playwright.config.ts",
      playwrightPath,
    );

    assert.ok(jestSignals.tooling.includes("jest"));
    assert.ok(jestSignals.concerns.includes("testing"));
    assert.ok(playwrightSignals.tooling.includes("playwright"));
    assert.ok(playwrightSignals.concerns.includes("e2e-testing"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals extract requirements.txt signals from various naming patterns", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-req-"));

  try {
    const reqPath = join(root, "requirements.txt");
    const reqDevPath = join(root, "requirements-dev.txt");
    const constraintsPath = join(root, "constraints.txt");
    const reqInDirPath = join(root, "requirements", "base.txt");

    await writeText(reqPath, "fastapi>=0.100\nopenai>=1.0");
    await writeText(reqDevPath, "pytest>=8\nblack>=23");
    await writeText(constraintsPath, "numpy==1.26.0");
    await writeText(reqInDirPath, "redis>=5\n");

    const reqSignals = await collectDemandSignalsForFile(
      "requirements.txt",
      reqPath,
    );
    const reqDevSignals = await collectDemandSignalsForFile(
      "requirements-dev.txt",
      reqDevPath,
    );
    const constraintsSignals = await collectDemandSignalsForFile(
      "constraints.txt",
      constraintsPath,
    );
    const reqInDirSignals = await collectDemandSignalsForFile(
      "base.txt",
      reqInDirPath,
    );

    assert.ok(reqSignals.languages.includes("python"));
    assert.ok(reqSignals.packageManagers.includes("pip"));
    assert.ok(reqSignals.tooling.includes("pypi:fastapi"));
    assert.ok(reqDevSignals.tooling.includes("pypi:pytest"));
    assert.ok(constraintsSignals.languages.includes("python"));
    assert.ok(reqInDirSignals.languages.includes("python"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
