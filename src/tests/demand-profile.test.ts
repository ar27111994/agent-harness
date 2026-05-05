import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { shouldInspectFile } from "../domains/discovery/demand-signals.js";
import { buildDemandProfile } from "../discover.js";
import type { DemandSignalSet } from "../types.js";

interface DemandProfileRepoFixture {
  archetype: string;
  files: Array<{ path: string; content: string }>;
  expectedSignals: Partial<DemandSignalSet>;
  unexpectedSignals?: Partial<DemandSignalSet>;
  expectedMatchedFilesMin: number;
}

void test("mobile project marker files are inspectable", () => {
  for (const fileName of [
    "Podfile",
    "AndroidManifest.xml",
    "Info.plist",
    "project.pbxproj",
  ]) {
    assert.equal(shouldInspectFile(fileName, `mobile/${fileName}`), true);
  }
});

const repoFixtures: DemandProfileRepoFixture[] = [
  {
    archetype: "frontend-web-app",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "@vitejs/plugin-react": "latest",
            react: "latest",
            typescript: "latest",
          },
          devDependencies: { vitest: "latest" },
        }),
      },
      { path: "docs/README.md", content: "# Frontend docs\n" },
    ],
    expectedSignals: {
      languages: ["javascript", "typescript"],
      frameworks: ["react"],
      concerns: ["frontend", "testing"],
      tooling: ["npm:react", "npm:typescript"],
    },
    expectedMatchedFilesMin: 2,
  },
  {
    archetype: "python-backend",
    files: [
      { path: "requirements.txt", content: "fastapi\nuvicorn\npytest\n" },
      { path: "api/openapi.yaml", content: "openapi: 3.1.0\n" },
    ],
    expectedSignals: {
      languages: ["python"],
      frameworks: ["fastapi"],
      concerns: ["backend", "api-design", "testing"],
      tooling: ["pypi:fastapi", "openapi"],
    },
    expectedMatchedFilesMin: 2,
  },
  {
    archetype: "research-data",
    files: [
      { path: "notebooks/analysis.ipynb", content: "{}" },
      { path: "papers/paper.tex", content: "\\section{Results}" },
      { path: "data/events.parquet", content: "fixture" },
    ],
    expectedSignals: {
      languages: ["python"],
      concerns: ["notebooks", "research", "data", "data-engineering"],
      tooling: ["jupyter", "latex"],
    },
    expectedMatchedFilesMin: 3,
  },
  {
    archetype: "hardware-game-media",
    files: [
      { path: "hardware/board.kicad_pcb", content: "fixture" },
      { path: "game/project.godot", content: "fixture" },
      { path: "media/scene.blend", content: "fixture" },
    ],
    expectedSignals: {
      concerns: [
        "cad",
        "hardware",
        "game-development",
        "media",
        "design-assets",
      ],
      tooling: ["cad", "godot", "asset-pipeline"],
    },
    expectedMatchedFilesMin: 3,
  },
  {
    archetype: "typescript-apify-webhook",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "webhook-debugger-logger",
          description: "Apify actor for webhook debugging and logging",
          dependencies: {
            "@apify/client": "latest",
            apify: "latest",
            express: "latest",
            typescript: "latest",
          },
          devDependencies: { vitest: "latest" },
        }),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({ compilerOptions: { target: "ES2022" } }),
      },
    ],
    expectedSignals: {
      languages: ["javascript", "typescript"],
      frameworks: ["apify", "express"],
      concerns: [
        "automation",
        "web-scraping",
        "backend",
        "api-design",
        "webhook",
        "logging",
        "debugging",
      ],
      tooling: ["actor", "crawler", "npm:@apify/client", "webhook"],
    },
    unexpectedSignals: {
      languages: ["rust"],
      concerns: [
        "robotics",
        "systems-engineering",
        "pentesting",
        "game-development",
        "3d-printing",
      ],
    },
    expectedMatchedFilesMin: 2,
  },
  {
    archetype: "flutter-firebase-mobile",
    files: [
      {
        path: "pubspec.yaml",
        content:
          "name: interact_note\ndependencies:\n    flutter:\n      sdk: flutter\n    firebase_core: ^3.0.0\n    firebase_auth: ^5.0.0\n    cloud_firestore: ^5.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\ntest_dependencies:\n    integration_test:\n      sdk: flutter\n",
      },
      {
        path: "android/app/build.gradle.kts",
        content:
          'plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }\nandroid { namespace = "app.interactnote" }\n',
      },
    ],
    expectedSignals: {
      languages: ["dart", "kotlin"],
      packageManagers: ["pub", "maven-gradle"],
      frameworks: ["flutter", "firebase"],
      concerns: [
        "mobile",
        "frontend",
        "backend",
        "database",
        "authentication",
        "android",
      ],
      tooling: [
        "flutter",
        "pub:flutter",
        "pub:firebase_core",
        "pub:integration_test",
        "android-gradle",
      ],
    },
    unexpectedSignals: {
      frameworks: ["apify"],
      concerns: ["robotics", "game-development", "pentesting", "web-scraping"],
      tooling: ["pub:sdk"],
    },
    expectedMatchedFilesMin: 2,
  },
  {
    archetype: "native-mobile-polyglot",
    files: [
      {
        path: "ios/AppDelegate.swift",
        content:
          "import UIKit\nclass AppDelegate: UIResponder, UIApplicationDelegate {}\n",
      },
      {
        path: "ios/LegacyViewController.m",
        content:
          "#import <UIKit/UIKit.h>\n@implementation LegacyViewController\n@end\n",
      },
      {
        path: "ios/Podfile",
        content: "platform :ios, '17.0'\ntarget 'Example' do\nend\n",
      },
      {
        path: "android/app/src/main/java/com/example/MainActivity.java",
        content: "package com.example; public class MainActivity {}\n",
      },
      {
        path: "android/app/src/main/kotlin/com/example/MainActivity.kt",
        content: "package com.example\nclass MainActivity\n",
      },
      {
        path: "MobileApp.csproj",
        content:
          '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFrameworks>net8.0-ios;net8.0-android</TargetFrameworks><UseMaui>true</UseMaui></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.Maui.Controls" /></ItemGroup></Project>',
      },
    ],
    expectedSignals: {
      languages: ["swift", "objective-c", "java", "kotlin", "csharp"],
      packageManagers: ["cocoapods", "nuget"],
      frameworks: ["maui"],
      concerns: ["mobile", "ios", "android"],
      tooling: ["ios", "android", "cocoapods", "dotnet-maui"],
    },
    expectedMatchedFilesMin: 6,
  },
  {
    archetype: "cloud-automation-blockchain",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "@apify/client": "latest",
            "@azure/storage-blob": "latest",
            "@google-cloud/storage": "latest",
            ethers: "latest",
            hardhat: "latest",
          },
        }),
      },
    ],
    expectedSignals: {
      frameworks: ["apify"],
      concerns: [
        "automation",
        "web-scraping",
        "cloud",
        "blockchain",
        "cryptography",
      ],
      tooling: ["azure", "gcp", "web3", "npm:@apify/client"],
    },
    expectedMatchedFilesMin: 1,
  },
  {
    archetype: "fullstack-polyglot-platforms",
    files: [
      {
        path: "pom.xml",
        content:
          "<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>",
      },
      { path: "api/go.mod", content: "github.com/gin-gonic/gin v1.10.0" },
      {
        path: "backend/Cargo.toml",
        content: '[dependencies]\naxum = "0.7"\ntonic = "0.12"',
      },
      {
        path: "src/Web.csproj",
        content:
          '<Project Sdk="Microsoft.NET.Sdk.Web"><PackageReference Include="Microsoft.AspNetCore.App" /></Project>',
      },
      {
        path: "composer.json",
        content: '{"require":{"laravel/framework":"*"}}',
      },
      { path: "Gemfile", content: "gem 'rails'\n" },
    ],
    expectedSignals: {
      languages: ["java", "go", "rust", "csharp", "php", "ruby"],
      frameworks: [
        "java-backend",
        "go-backend",
        "rust-backend",
        "dotnet-backend",
        "backend-framework",
      ],
      concerns: ["backend", "api-design"],
      tooling: [
        "maven:org.springframework.boot:spring-boot-starter-web",
        "go:github.com/gin-gonic/gin",
        "cargo:axum",
        "nuget:Microsoft.AspNetCore.App",
        "packagist:laravel/framework",
        "gem:rails",
      ],
    },
    expectedMatchedFilesMin: 6,
  },
  {
    archetype: "expanded-cad-game-digital-design",
    files: [
      { path: "cad/model.FCStd", content: "fixture" },
      { path: "cad/part.scad", content: "fixture" },
      { path: "electronics/board.gbr", content: "fixture" },
      { path: "game/level.umap", content: "fixture" },
      { path: "godot/scene.tscn", content: "fixture" },
      { path: "design/tokens.json", content: '{"name":"design system"}' },
      { path: "vfx/shot.aep", content: "fixture" },
      { path: "audio/song.mid", content: "fixture" },
    ],
    expectedSignals: {
      concerns: [
        "cad",
        "hardware",
        "game-development",
        "design-systems",
        "design-assets",
        "media",
      ],
      tooling: ["cad", "game-engine", "asset-pipeline"],
    },
    expectedMatchedFilesMin: 8,
  },
  {
    archetype: "ai-security-marketing-robotics",
    files: [
      {
        path: "requirements.txt",
        content: [
          "torch",
          "stable-baselines3",
          "scapy",
          "google-ads",
          "pymavlink",
        ].join("\n"),
      },
      { path: "robot/model.urdf", content: "<robot />" },
    ],
    expectedSignals: {
      concerns: [
        "ai",
        "machine-learning",
        "reinforcement-learning",
        "security",
        "pentesting",
        "marketing",
        "robotics",
      ],
      tooling: ["ros", "pypi:torch", "pypi:google-ads"],
    },
    expectedMatchedFilesMin: 2,
  },
  {
    archetype: "trading-bi-market-analysis",
    files: [
      {
        path: "requirements-dev.txt",
        content: "ccxt\nyfinance\nbacktrader\nstreamlit\n",
      },
      {
        path: "trading/strategies/breakout.pine",
        content: "strategy('breakout')",
      },
      { path: "dashboards/sales.pbix", content: "fixture" },
    ],
    expectedSignals: {
      languages: ["python"],
      concerns: [
        "trading",
        "market-analysis",
        "quant-finance",
        "financial-data",
        "backtesting",
        "business-intelligence",
        "dashboarding",
        "reporting",
      ],
      tooling: ["pypi:ccxt", "backtesting", "power-bi"],
    },
    expectedMatchedFilesMin: 3,
  },
  {
    archetype: "devops-network-platform",
    files: [
      { path: ".github/workflows/ci.yml", content: "name: ci\n" },
      { path: "charts/app/Chart.yaml", content: "apiVersion: v2\nname: app\n" },
      { path: "ansible/playbook.yml", content: "- hosts: all\n" },
      { path: "requirements/ops.txt", content: "ansible\nnapalm\nnetmiko\n" },
    ],
    expectedSignals: {
      languages: ["python"],
      concerns: [
        "devops",
        "ci-cd",
        "infrastructure",
        "platform-engineering",
        "networking",
        "netops",
        "network-automation",
      ],
      tooling: ["kubernetes", "helm", "ansible", "pypi:netmiko"],
    },
    unexpectedSignals: {
      concerns: ["business-analysis"],
    },
    expectedMatchedFilesMin: 4,
  },
  {
    archetype: "dockerfile-comment-no-embedded",
    files: [
      {
        path: "Dockerfile",
        content: [
          "FROM ubuntu:22.04",
          "# Create an embedded entrypoint script",
          "RUN echo ready",
        ].join("\n"),
      },
    ],
    expectedSignals: {
      concerns: ["containerization", "infrastructure"],
      tooling: ["docker"],
    },
    unexpectedSignals: {
      concerns: ["embedded", "firmware", "rtos", "hardware", "iot"],
    },
    expectedMatchedFilesMin: 1,
  },
  {
    archetype: "mlops-rag-creative-media",
    files: [
      {
        path: "requirements.txt",
        content: "mlflow\nchromadb\nsentence-transformers\npydub\n",
      },
      { path: "models/assistant.gguf", content: "fixture" },
      { path: "audio/theme.rpp", content: "fixture" },
    ],
    expectedSignals: {
      concerns: [
        "machine-learning",
        "deep-learning",
        "mlops",
        "rag",
        "vector-search",
        "model-artifacts",
        "audio-production",
        "music",
      ],
      tooling: ["pypi:mlflow", "pypi:chromadb"],
    },
    expectedMatchedFilesMin: 3,
  },
  {
    archetype: "embedded-robotics-blockchain",
    files: [
      {
        path: "Cargo.toml",
        content:
          '[workspace.dependencies]\nembedded-hal = "1"\nanchor-lang = "0.30"\n',
      },
      {
        path: "firmware/platformio.ini",
        content: "[env:esp32]\nplatform = espressif32\n",
      },
      {
        path: "robotics/nav2/nav.launch.py",
        content: "from launch import LaunchDescription\n",
      },
    ],
    expectedSignals: {
      languages: ["rust"],
      concerns: [
        "embedded",
        "firmware",
        "hardware",
        "iot",
        "blockchain",
        "smart-contracts",
        "robotics",
        "motion-planning",
        "autonomy",
      ],
      tooling: ["cargo:embedded-hal", "cargo:anchor-lang"],
    },
    expectedMatchedFilesMin: 3,
  },
  {
    archetype: "data-mining-seo-content",
    files: [
      { path: "dbt_project.yml", content: "name: analytics\n" },
      { path: "dvc.yaml", content: "stages: {}\n" },
      {
        path: "scrapers/requirements.txt",
        content: "scrapy\nbeautifulsoup4\n",
      },
      {
        path: "content-marketing/cms/sitemap.xml",
        content: "<urlset></urlset>",
      },
      {
        path: "campaigns/landing-pages/robots.txt",
        content: "User-agent: *\nAllow: /\n",
      },
      { path: "public/robots.txt", content: "User-agent: *\nAllow: /\n" },
    ],
    expectedSignals: {
      languages: ["python"],
      concerns: [
        "data-engineering",
        "data-mining",
        "etl",
        "analytics-engineering",
        "marketing",
        "seo",
        "content-marketing",
        "cms",
        "campaigns",
      ],
      tooling: ["pypi:scrapy"],
    },
    unexpectedSignals: {
      concerns: ["business-analysis"],
    },
    expectedMatchedFilesMin: 6,
  },
  {
    archetype: "php-cms-frameworks",
    files: [
      {
        path: "composer.json",
        content: JSON.stringify({
          require: {
            "laravel/framework": "*",
            "codeigniter4/framework": "*",
            "laminas/laminas-mvc": "*",
            "roots/wordpress": "*",
            "drupal/core": "*",
            "joomla/joomla-cms": "*",
          },
        }),
      },
    ],
    expectedSignals: {
      languages: ["php"],
      packageManagers: ["composer"],
      frameworks: ["backend-framework"],
      concerns: ["backend", "api-design", "cms"],
      tooling: [
        "packagist:laravel/framework",
        "packagist:codeigniter4/framework",
        "wordpress",
        "drupal",
        "joomla",
      ],
    },
    expectedMatchedFilesMin: 1,
  },
  {
    archetype: "systems-and-beam-polyglot",
    files: [
      { path: "native/src/main.c", content: "int main(void) { return 0; }" },
      { path: "native/src/lib.cpp", content: "int answer() { return 42; }" },
      {
        path: "native/CMakeLists.txt",
        content: "project(native LANGUAGES C CXX)",
      },
      { path: "native/Makefile", content: "all:\n\tcc main.c\n" },
      { path: "go/main.go", content: "package main\nfunc main() {}\n" },
      { path: "rust/src/lib.rs", content: "pub fn answer() -> i32 { 42 }\n" },
      { path: "erlang/src/app.erl", content: "-module(app).\n" },
      { path: "erlang/rebar.config", content: "{deps, [cowboy]}.\n" },
      {
        path: "elixir/mix.exs",
        content: 'defp deps, do: [{:phoenix, "~> 1.7"}]\n',
      },
      { path: "julia/Project.toml", content: 'DataFrames = "uuid"\n' },
    ],
    expectedSignals: {
      languages: ["c", "cpp", "go", "rust", "erlang", "elixir", "julia"],
      packageManagers: ["rebar", "hex", "julia-pkg"],
      frameworks: ["backend-framework"],
      concerns: ["backend", "systems-programming", "scientific-computing"],
      tooling: ["cmake", "make"],
    },
    expectedMatchedFilesMin: 10,
  },
  {
    archetype: "lockfile-no-text-intent",
    files: [
      {
        path: "package-lock.json",
        content: JSON.stringify({ packages: { "node_modules/debug": {} } }),
      },
    ],
    expectedSignals: {
      packageManagers: ["npm"],
    },
    unexpectedSignals: {
      concerns: ["logging", "debugging", "mocking", "replay"],
    },
    expectedMatchedFilesMin: 1,
  },
];

void test("demand profiles produce meaningful signals for representative repo archetypes", async () => {
  for (const fixture of repoFixtures) {
    const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-"));
    try {
      await writeFixtureFiles(root, fixture.files);
      const profile = await buildDemandProfile(root);

      assert.equal(profile.summary.scanTruncated, false, fixture.archetype);
      assert.ok(
        profile.summary.matchedFiles >= fixture.expectedMatchedFilesMin,
        `${fixture.archetype} matched ${profile.summary.matchedFiles} files`,
      );
      assertExpectedSignals(
        fixture.archetype,
        profile.signals,
        fixture.expectedSignals,
      );
      assertUnexpectedSignals(
        fixture.archetype,
        profile.signals,
        fixture.unexpectedSignals ?? {},
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});

async function writeFixtureFiles(
  root: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  for (const file of files) {
    const filePath = join(root, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }
}

function assertExpectedSignals(
  archetype: string,
  actualSignals: DemandSignalSet,
  expectedSignals: Partial<DemandSignalSet>,
): void {
  for (const [signalKind, expectedValues] of Object.entries(expectedSignals)) {
    const actualValues = actualSignals[signalKind as keyof DemandSignalSet];
    for (const expectedValue of expectedValues ?? []) {
      assert.ok(
        actualValues.includes(expectedValue),
        `${archetype} should emit ${signalKind}:${expectedValue}`,
      );
    }
  }
}

function assertUnexpectedSignals(
  archetype: string,
  actualSignals: DemandSignalSet,
  unexpectedSignals: Partial<DemandSignalSet>,
): void {
  for (const [signalKind, unexpectedValues] of Object.entries(
    unexpectedSignals,
  )) {
    const actualValues = actualSignals[signalKind as keyof DemandSignalSet];
    for (const unexpectedValue of unexpectedValues ?? []) {
      assert.ok(
        !actualValues.includes(unexpectedValue),
        `${archetype} should not emit ${signalKind}:${unexpectedValue}`,
      );
    }
  }
}
