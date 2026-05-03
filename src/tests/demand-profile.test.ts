import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildDemandProfile } from "../discover.js";
import type { DemandSignalSet } from "../types.js";

interface DemandProfileRepoFixture {
  archetype: string;
  files: Array<{ path: string; content: string }>;
  expectedSignals: Partial<DemandSignalSet>;
  expectedMatchedFilesMin: number;
}

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
