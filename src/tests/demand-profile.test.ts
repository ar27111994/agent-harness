import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  getDemandEvidenceStrength,
  shouldInspectFile,
} from "../domains/discovery/demand-signals.js";
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

void test("demand evidence strength ignores planning templates and demotes markdown docs", () => {
  assert.equal(
    getDemandEvidenceStrength(
      "feature_request.md",
      ".github/ISSUE_TEMPLATE/feature_request.md",
    ),
    null,
  );
  assert.equal(getDemandEvidenceStrength("CHANGELOG.md", "CHANGELOG.md"), null);
  assert.equal(
    getDemandEvidenceStrength("README.md", "docs/README.md"),
    "weak",
  );
  assert.equal(
    getDemandEvidenceStrength("package.json", "package.json"),
    "strong",
  );
  assert.equal(
    getDemandEvidenceStrength("analysis.ipynb", "notebooks/analysis.ipynb"),
    "medium",
  );
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
      {
        path: "design/penpot-mrds.md",
        content:
          "# Penpot MRDS\nPenpot is the canonical machine-readable design system. The penpot-official MCP runs at http://localhost:4401/mcp and provides design-source data for frontend design work.\n",
      },
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
        "design-source",
        "design-mcp",
        "frontend-design",
        "penpot",
        "penpot-mrds",
        "media",
      ],
      tooling: ["cad", "game-engine", "asset-pipeline", "penpot"],
    },
    expectedMatchedFilesMin: 9,
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
    archetype: "dockerfile-run-text-signals",
    files: [
      {
        path: "Dockerfile",
        content: [
          "FROM node:20",
          "RUN npm install -g apify",
          "RUN echo webhook >> /tmp/features.txt",
        ].join("\n"),
      },
    ],
    expectedSignals: {
      frameworks: ["apify"],
      concerns: ["automation", "web-scraping", "containerization", "webhook"],
      tooling: ["actor", "crawler", "docker", "webhook"],
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

void test("demand profiles ignore planning templates and keep evidence strength visible", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-wave-"));

  try {
    await writeFixtureFiles(root, [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            apify: "latest",
            express: "latest",
          },
        }),
      },
      {
        path: "README.md",
        content:
          "# Workspace\nThis README mentions robotics, pentesting, and game development but should stay weak.\n",
      },
      {
        path: ".github/ISSUE_TEMPLATE/feature_request.md",
        content:
          "Please add marketing, robotics, and lead-generation workflows everywhere.\n",
      },
      {
        path: "IMPLEMENTATION-PLAN.md",
        content:
          "Future ideas: blockchain, content-creation, realtime-media, and SEO.\n",
      },
    ]);

    const profile = await buildDemandProfile(root);

    assert.ok(profile.signals.frameworks.includes("apify"));
    assert.ok(profile.signals.concerns.includes("automation"));
    assert.ok(!profile.signals.concerns.includes("robotics"));
    assert.ok(!profile.signals.concerns.includes("marketing"));
    assert.ok(
      !profile.evidence.some((entry) =>
        entry.path.includes(".github/ISSUE_TEMPLATE/feature_request.md"),
      ),
    );
    assert.ok(
      !profile.evidence.some((entry) =>
        entry.path.includes("IMPLEMENTATION-PLAN.md"),
      ),
    );
    assert.equal(
      profile.evidence.find((entry) => entry.path === "README.md")
        ?.evidenceStrength,
      "weak",
    );
    assert.equal(
      profile.evidence.find((entry) => entry.path === "package.json")
        ?.evidenceStrength,
      "strong",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("demand profiles prioritize root manifests before nested docs when scan budgets truncate", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-priority-"));
  const previousMaxBytes = process.env.AGENT_HARNESS_SCAN_MAX_BYTES;

  try {
    process.env.AGENT_HARNESS_SCAN_MAX_BYTES = "4096";
    clearRuntimeConfigForTests();

    await writeFixtureFiles(root, [
      {
        path: "pubspec.yaml",
        content:
          "name: interact_note\ndependencies:\n  flutter:\n    sdk: flutter\n  firebase_core: ^3.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n",
      },
      {
        path: "agent-docs/skills/doc-1/SKILL.md",
        content: `${"# Skill\n"}${"docs \n".repeat(1500)}`,
      },
      {
        path: "agent-docs/skills/doc-2/SKILL.md",
        content: `${"# Skill\n"}${"research \n".repeat(1500)}`,
      },
    ]);

    const profile = await buildDemandProfile(root);

    assert.equal(profile.summary.scanTruncated, true);
    assert.ok(profile.signals.languages.includes("dart"));
    assert.ok(profile.signals.frameworks.includes("flutter"));
    assert.ok(profile.signals.packageManagers.includes("pub"));
    assert.ok(
      profile.evidence.some((entry) => entry.path === "pubspec.yaml"),
      "expected pubspec.yaml evidence to survive truncation",
    );
  } finally {
    if (previousMaxBytes === undefined) {
      delete process.env.AGENT_HARNESS_SCAN_MAX_BYTES;
    } else {
      process.env.AGENT_HARNESS_SCAN_MAX_BYTES = previousMaxBytes;
    }
    clearRuntimeConfigForTests();
    await rm(root, { force: true, recursive: true });
  }
});

void test("demand profiles ignore agent metadata directories by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-ignore-"));

  try {
    await writeFixtureFiles(root, [
      {
        path: "pubspec.yaml",
        content:
          "name: interact_note\ndependencies:\n  flutter:\n    sdk: flutter\n",
      },
      {
        path: ".agent/skills/python-docs/SKILL.md",
        content:
          "# Python docs\nUse deepeval, pytest, and google-genai for AI research workflows.\n",
      },
      {
        path: ".specify/extensions/python-docs/README.md",
        content:
          "Document deepeval, pytest, pyyaml, and google-genai for AI research workflows.\n",
      },
      {
        path: ".dart_tool/some_meta.txt",
        content:
          "Ignore kotlin gradle metadata and pytest-like markers from generated files.\n",
      },
    ]);

    const profile = await buildDemandProfile(root);

    assert.ok(profile.signals.languages.includes("dart"));
    assert.ok(profile.signals.frameworks.includes("flutter"));
    assert.ok(!profile.signals.languages.includes("python"));
    assert.ok(!profile.signals.languages.includes("kotlin"));
    assert.ok(!profile.signals.packageManagers.includes("gradle"));
    assert.ok(!profile.signals.tooling.includes("pypi:deepeval"));
    assert.ok(
      !profile.evidence.some((entry) => entry.path.startsWith(".agent/")),
    );
    assert.ok(
      !profile.evidence.some((entry) => entry.path.startsWith(".dart_tool/")),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("demand profile skips ignored non-demand files before evidence collection", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-demand-profile-null-evidence-"),
  );

  try {
    await writeFixtureFiles(root, [
      {
        path: "CHANGELOG.md",
        content: "# Changelog\n\nMentions React only historically.\n",
      },
      { path: "docs/README.md", content: "# Docs\n" },
    ]);

    const profile = await buildDemandProfile(root);

    assert.equal(profile.summary.scannedFiles, 2);
    assert.deepEqual(
      profile.evidence.map((entry) => entry.path),
      ["docs/README.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("demand profile skips non-signal evidence and sorts matched evidence paths", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-demand-profile-sort-"),
  );

  try {
    await writeFixtureFiles(root, [
      {
        path: "z-app/package.json",
        content: JSON.stringify({
          dependencies: { typescript: "^5.0.0" },
          packageManager: "pnpm@9.0.0",
        }),
      },
      { path: "a-app/requirements.txt", content: "fastapi==0.110.0\n" },
      { path: "docs/notes.md", content: "\n" },
      { path: "gradle/settings.gradle", content: "\n" },
      { path: "ignored/asset.bin", content: "\n" },
    ]);

    const profile = await buildDemandProfile(root);

    assert.equal(profile.summary.scannedFiles, 5);
    assert.deepEqual(
      profile.evidence.map((entry) => entry.path),
      ["a-app/requirements.txt", "docs/notes.md", "z-app/package.json"],
    );
    assert.ok(profile.signals.packageManagers.includes("pnpm"));
    assert.ok(profile.signals.tooling.includes("pypi:fastapi"));
    assert.ok(profile.signals.tooling.includes("typescript"));
  } finally {
    await rm(root, { force: true, recursive: true });
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

void test("binary/asset files are deprioritised in scan order so source files exhaust the byte budget first", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-binary-priority-"));
  try {
    // Write a source file that adds dart+flutter signals
    await writeFixtureFile(
      root,
      "pubspec.yaml",
      [
        "name: interact_note",
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
      ].join("\n"),
    );
    // Write a large binary-extension file that, if scanned first, would
    // exhaust the budget before pubspec.yaml is reached.
    // We use a 1-byte placeholder — the test relies on sort order, not actual size.
    await writeFixtureFile(root, "assets/splash.png", "FAKE_PNG");
    await writeFixtureFile(root, "assets/font.ttf", "FAKE_TTF");
    await writeFixtureFile(root, "assets/icon.ico", "FAKE_ICO");

    // Set a byte budget equal to just enough to read pubspec.yaml (the source
    // file) but no more — any additional file visit will overflow the budget.
    // This ensures the scan IS truncated, which validates binary-deprioritisation:
    // if binaries had been sorted first, pubspec.yaml would never be reached.
    const pubspecContent = [
      "name: interact_note",
      "dependencies:",
      "  flutter:",
      "    sdk: flutter",
    ].join("\n");
    const tightBudgetBytes = Buffer.byteLength(pubspecContent, "utf8");
    const previousMaxBytes = process.env.AGENT_HARNESS_SCAN_MAX_BYTES;
    process.env.AGENT_HARNESS_SCAN_MAX_BYTES = String(tightBudgetBytes);
    clearRuntimeConfigForTests();

    try {
      const profile = await buildDemandProfile(root);
      // pubspec.yaml (small) must survive even though binaries exist
      assert.ok(
        profile.evidence.some((e) => e.path === "pubspec.yaml"),
        "pubspec.yaml must be scanned before binary assets",
      );
      assert.ok(
        profile.signals.frameworks.includes("flutter"),
        "flutter signal must be detected despite binary assets",
      );
      // The 100-byte budget MUST have been hit — if the scan was NOT truncated
      // it means the budget was not tight enough to validate priority ordering.
      assert.equal(
        profile.summary.scanTruncated,
        true,
        "scan must be truncated so that binary-deprioritisation is actually exercised",
      );
    } finally {
      if (previousMaxBytes === undefined) {
        delete process.env.AGENT_HARNESS_SCAN_MAX_BYTES;
      } else {
        process.env.AGENT_HARNESS_SCAN_MAX_BYTES = previousMaxBytes;
      }
      clearRuntimeConfigForTests();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("buildDemandProfile emits a [warn] line on stderr when scan is truncated", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-truncation-warn-"));
  const previousMaxBytes = process.env.AGENT_HARNESS_SCAN_MAX_BYTES;
  process.env.AGENT_HARNESS_SCAN_MAX_BYTES = "5";
  clearRuntimeConfigForTests();

  const stderrChunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (
    chunk: Uint8Array | string,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    if (typeof chunk === "string") {
      stderrChunks.push(chunk);
    }
    if (typeof encodingOrCb === "function") {
      return originalWrite(chunk, encodingOrCb);
    }
    if (encodingOrCb !== undefined) {
      return originalWrite(chunk, encodingOrCb, cb);
    }
    return originalWrite(chunk);
  };

  try {
    await writeFixtureFile(
      root,
      "pubspec.yaml",
      "name: interact_note\ndependencies:\n  flutter:\n    sdk: flutter\n",
    );
    await buildDemandProfile(root);

    const combined = stderrChunks.join("");
    assert.ok(
      combined.includes("[warn]") && combined.includes("truncated"),
      `expected [warn] truncation message on stderr, got: ${combined}`,
    );
  } finally {
    process.stderr.write = originalWrite;
    if (previousMaxBytes === undefined) {
      delete process.env.AGENT_HARNESS_SCAN_MAX_BYTES;
    } else {
      process.env.AGENT_HARNESS_SCAN_MAX_BYTES = previousMaxBytes;
    }
    clearRuntimeConfigForTests();
    await rm(root, { force: true, recursive: true });
  }
});

async function writeFixtureFile(
  root: string,
  relPath: string,
  content: string,
): Promise<void> {
  const full = join(root, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}
