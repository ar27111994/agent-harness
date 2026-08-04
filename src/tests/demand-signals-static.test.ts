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
    const envExamplePath = join(root, ".env.example");

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
      envExamplePath,
    ]) {
      await writeText(filePath, "# placeholder content\n");
    }
    await writeText(
      envExamplePath,
      "PENPOT_MCP_URL=http://localhost:4401/mcp\n",
    );

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
    const envExampleSignals = await collectDemandSignalsForFile(
      ".env.example",
      envExamplePath,
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
    assert.ok(envExampleSignals.concerns.includes("penpot"));
    assert.ok(envExampleSignals.concerns.includes("design-mcp"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals inspect and detect Conan and Meson C/C++ manifests", async () => {
  // Cross-ecosystem fixture coverage: conanfile.txt / conanfile.py are the
  // canonical ConanCenter manifests and meson.build the Meson build file.
  // Without them, the conan/meson ecosystem terms in the demand-relevant
  // source gate are unreachable, and C++ projects using only these files
  // would not surface the conan-registry source.
  assert.equal(
    shouldInspectFile("conanfile.txt", "/project/conanfile.txt"),
    true,
  );
  assert.equal(
    shouldInspectFile("conanfile.py", "/project/conanfile.py"),
    true,
  );
  assert.equal(shouldInspectFile("meson.build", "/project/meson.build"), true);

  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-cpp-"));

  try {
    const conanTxtPath = join(root, "conanfile.txt");
    const conanPyPath = join(root, "conanfile.py");
    const mesonPath = join(root, "meson.build");
    await writeText(conanTxtPath, "[requires]\nopenssl/3.0.0\n");
    await writeText(conanPyPath, "from conan import ConanFile\n");
    await writeText(mesonPath, "project('demo', 'cpp')\n");

    const conanTxtSignals = await collectDemandSignalsForFile(
      "conanfile.txt",
      conanTxtPath,
    );
    const conanPySignals = await collectDemandSignalsForFile(
      "conanfile.py",
      conanPyPath,
    );
    const mesonSignals = await collectDemandSignalsForFile(
      "meson.build",
      mesonPath,
    );

    for (const signals of [conanTxtSignals, conanPySignals]) {
      assert.ok(signals.languages.includes("c"), "conan signals c language");
      assert.ok(
        signals.languages.includes("cpp"),
        "conan signals cpp language",
      );
      assert.ok(
        signals.packageManagers.includes("conan"),
        "conan manifest signals conan package manager",
      );
      assert.ok(
        signals.tooling.includes("conan"),
        "conan manifest signals conan tooling",
      );
    }

    assert.ok(mesonSignals.languages.includes("c"), "meson signals c language");
    assert.ok(
      mesonSignals.languages.includes("cpp"),
      "meson signals cpp language",
    );
    assert.ok(
      mesonSignals.tooling.includes("meson"),
      "meson signals meson tooling",
    );
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

void test("demand signals extract mobile framework and manifest edge signals", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-demand-mobile-edge-"),
  );

  try {
    const packagePath = join(root, "package.json");
    const invalidPackagePath = join(root, "invalid-package.json");
    const sparsePackagePath = join(root, "sparse-package.json");
    const pubspecPath = join(root, "pubspec.yaml");
    const csprojPath = join(root, "maui", "MobileApp.csproj");
    const xamarinPath = join(root, "xamarin", "LegacyApp.csproj");
    const gradlePath = join(root, "android", "build.gradle");
    const missingActorPath = join(root, ".actor", "actor.json");

    await writeText(
      packagePath,
      JSON.stringify({
        name: "mobile-test-app",
        description: "React Native testing harness",
        packageManager: "pnpm@9.0.0",
        engines: { node: ">=20" },
        author: { name: "Acme" },
        dependencies: { typescript: "^5.0.0", react: "^18.0.0" },
      }),
    );
    await writeText(invalidPackagePath, "{not-json");
    await writeText(
      sparsePackagePath,
      JSON.stringify({
        name: "sparse-node-tool",
        author: "Acme Labs",
        optionalDependencies: { playwright: "^1.0.0" },
        peerDependencies: { express: "^4.0.0" },
      }),
    );
    await writeText(
      pubspecPath,
      [
        "name: flutter_app",
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
        "  http: ^1.0.0",
        "dev_dependencies:",
        "  flutter_test:",
        "    sdk: flutter",
      ].join("\n"),
    );
    await writeText(
      csprojPath,
      [
        "<Project>",
        "<PropertyGroup>",
        "<TargetFrameworks>net8.0-ios;net8.0-android</TargetFrameworks>",
        "<UseMaui>true</UseMaui>",
        "</PropertyGroup>",
        "</Project>",
      ].join(""),
    );
    await writeText(
      xamarinPath,
      '<Project><ItemGroup><PackageReference Include="Xamarin.Forms" Version="5.0.0" /></ItemGroup></Project>',
    );
    await writeText(
      gradlePath,
      [
        "plugins {",
        "  id 'org.jetbrains.kotlin.android'",
        "  id 'com.android.library'",
        "}",
      ].join("\n"),
    );

    const packageSignals = await collectDemandSignalsForFile(
      "package.json",
      packagePath,
    );
    const invalidPackageSignals = await collectDemandSignalsForFile(
      "package.json",
      invalidPackagePath,
    );
    const sparsePackageSignals = await collectDemandSignalsForFile(
      "package.json",
      sparsePackagePath,
    );
    const pubspecSignals = await collectDemandSignalsForFile(
      "pubspec.yaml",
      pubspecPath,
    );
    const mauiSignals = await collectDemandSignalsForFile(
      "MobileApp.csproj",
      csprojPath,
    );
    const xamarinSignals = await collectDemandSignalsForFile(
      "LegacyApp.csproj",
      xamarinPath,
    );
    const gradleSignals = await collectDemandSignalsForFile(
      "build.gradle",
      gradlePath,
    );
    const missingActorSignals = await collectDemandSignalsForFile(
      "actor.json",
      missingActorPath,
    );

    assert.ok(packageSignals.packageManagers.includes("pnpm"));
    assert.ok(packageSignals.tooling.includes("node"));
    assert.ok(packageSignals.languages.includes("typescript"));
    assert.deepEqual(invalidPackageSignals.tooling, []);
    assert.ok(sparsePackageSignals.tooling.includes("npm:playwright"));
    assert.ok(sparsePackageSignals.tooling.includes("npm:express"));

    assert.ok(pubspecSignals.languages.includes("dart"));
    assert.ok(pubspecSignals.frameworks.includes("flutter"));
    assert.ok(pubspecSignals.tooling.includes("pub:http"));
    assert.ok(pubspecSignals.tooling.includes("pub:flutter_test"));

    assert.ok(mauiSignals.concerns.includes("ios"));
    assert.ok(mauiSignals.concerns.includes("android"));
    assert.ok(mauiSignals.frameworks.includes("maui"));
    assert.ok(mauiSignals.tooling.includes("dotnet-maui"));

    assert.ok(xamarinSignals.frameworks.includes("xamarin"));
    assert.ok(xamarinSignals.tooling.includes("xamarin"));

    assert.ok(gradleSignals.languages.includes("kotlin"));
    assert.ok(gradleSignals.tooling.includes("android-gradle"));
    assert.ok(missingActorSignals.concerns.includes("actor-development"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("demand signals tolerate sparse manifests and alternate source markers", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-sparse-"));

  try {
    const phpPath = join(root, "index.php");
    const rubyPath = join(root, "lib", "worker.rb");
    const missingPyprojectPath = join(root, "pyproject.toml");
    const missingPubspecPath = join(root, "pubspec.yaml");
    const minimalActorPath = join(root, ".actor", "actor.json");
    const gradleKtsPath = join(root, "build.gradle.kts");
    const gradleGroovyPath = join(root, "build.gradle");
    const gradlePluginPath = join(root, "android", "build.gradle");
    const emptyComposerPath = join(root, "composer.json");

    await writeText(phpPath, "<?php echo 'hello';");
    await writeText(rubyPath, "puts 'hello'");
    await writeText(minimalActorPath, "{}");
    await writeText(gradleKtsPath, 'plugins { kotlin("android") }');
    await writeText(gradleGroovyPath, "plugins { kotlin('android') }");
    await writeText(
      gradlePluginPath,
      "plugins { id 'org.jetbrains.kotlin.android' }",
    );
    await writeText(emptyComposerPath, "{}");

    const phpSignals = await collectDemandSignalsForFile("index.php", phpPath);
    const rubySignals = await collectDemandSignalsForFile(
      "worker.rb",
      rubyPath,
    );
    const missingPyprojectSignals = await collectDemandSignalsForFile(
      "pyproject.toml",
      missingPyprojectPath,
    );
    const missingPubspecSignals = await collectDemandSignalsForFile(
      "pubspec.yaml",
      missingPubspecPath,
    );
    const minimalActorSignals = await collectDemandSignalsForFile(
      "actor.json",
      minimalActorPath,
    );
    const gradleKtsSignals = await collectDemandSignalsForFile(
      "build.gradle.kts",
      gradleKtsPath,
    );
    const gradleGroovySignals = await collectDemandSignalsForFile(
      "build.gradle",
      gradleGroovyPath,
    );
    const gradlePluginSignals = await collectDemandSignalsForFile(
      "build.gradle",
      gradlePluginPath,
    );
    const composerSignals = await collectDemandSignalsForFile(
      "composer.json",
      emptyComposerPath,
    );

    assert.ok(phpSignals.languages.includes("php"));
    assert.ok(rubySignals.languages.includes("ruby"));

    assert.deepEqual(missingPyprojectSignals.tooling, []);
    assert.deepEqual(missingPubspecSignals.tooling, []);

    assert.ok(minimalActorSignals.concerns.includes("actor-development"));
    assert.ok(minimalActorSignals.tooling.includes("actor-runtime"));

    assert.ok(gradleKtsSignals.languages.includes("kotlin"));
    assert.ok(gradleGroovySignals.languages.includes("kotlin"));
    assert.ok(gradlePluginSignals.languages.includes("kotlin"));
    assert.ok(gradlePluginSignals.tooling.includes("android-gradle"));

    assert.deepEqual(composerSignals.tooling, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
