import type { DemandSignalSet } from "../../types.js";
import { addSignals } from "./signals.js";

export type PackageEcosystem = "npm" | "pypi";

export interface TechnologySignature {
  id: string;
  packages?: Partial<Record<PackageEcosystem, string[]>>;
  packagePrefixes?: Partial<Record<PackageEcosystem, string[]>>;
  textMarkers?: string[];
  signals: Partial<DemandSignalSet>;
}

export interface TechnologySignalContext {
  dependencyNames?: string[];
  ecosystem?: PackageEcosystem;
  text?: string;
}

export const TECHNOLOGY_SIGNATURES: TechnologySignature[] = [
  {
    id: "react",
    packages: { npm: ["react"] },
    signals: { frameworks: ["react"], concerns: ["frontend"] },
  },
  {
    id: "nextjs",
    packages: { npm: ["next"] },
    signals: { frameworks: ["nextjs"], concerns: ["frontend", "fullstack"] },
  },
  {
    id: "vue",
    packages: { npm: ["vue", "nuxt"] },
    signals: { frameworks: ["vue"], concerns: ["frontend"] },
  },
  {
    id: "angular",
    packages: { npm: ["@angular/core"] },
    packagePrefixes: { npm: ["@angular/"] },
    signals: { frameworks: ["angular"], concerns: ["frontend"] },
  },
  {
    id: "svelte",
    packages: { npm: ["svelte"] },
    packagePrefixes: { npm: ["@sveltejs/"] },
    signals: { frameworks: ["svelte"], concerns: ["frontend"] },
  },
  {
    id: "astro",
    packages: { npm: ["astro"] },
    packagePrefixes: { npm: ["@astrojs/"] },
    signals: { frameworks: ["astro"], concerns: ["frontend"] },
  },
  {
    id: "express",
    packages: { npm: ["express"] },
    signals: { frameworks: ["express"], concerns: ["backend", "api-design"] },
  },
  {
    id: "fastify",
    packages: { npm: ["fastify"] },
    signals: { frameworks: ["fastify"], concerns: ["backend", "api-design"] },
  },
  {
    id: "nestjs",
    packages: { npm: ["@nestjs/core"] },
    packagePrefixes: { npm: ["@nestjs/"] },
    signals: { frameworks: ["nestjs"], concerns: ["backend", "api-design"] },
  },
  {
    id: "hono",
    packages: { npm: ["hono"] },
    signals: { frameworks: ["hono"], concerns: ["backend", "api-design"] },
  },
  {
    id: "node-backend",
    packages: {
      npm: [
        "express",
        "fastify",
        "@nestjs/core",
        "hono",
        "koa",
        "@trpc/server",
      ],
    },
    signals: {
      frameworks: ["node-backend"],
      concerns: ["backend", "api-design"],
      tooling: ["node"],
    },
  },
  {
    id: "fastapi",
    packages: { pypi: ["fastapi"] },
    signals: { frameworks: ["fastapi"], concerns: ["backend", "api-design"] },
  },
  {
    id: "django",
    packages: { pypi: ["django"] },
    signals: { frameworks: ["django"], concerns: ["backend", "api-design"] },
  },
  {
    id: "flask",
    packages: { pypi: ["flask"] },
    signals: { frameworks: ["flask"], concerns: ["backend", "api-design"] },
  },
  {
    id: "litestar",
    packages: { pypi: ["litestar"] },
    signals: { frameworks: ["litestar"], concerns: ["backend", "api-design"] },
  },
  {
    id: "python-backend",
    packages: { pypi: ["fastapi", "django", "flask", "litestar"] },
    signals: {
      frameworks: ["python-backend"],
      concerns: ["backend", "api-design"],
    },
  },
  {
    id: "database-orm",
    packages: {
      npm: ["drizzle-orm", "prisma", "sequelize", "typeorm", "mongoose"],
    },
    signals: { concerns: ["database"], tooling: ["orm"] },
  },
  {
    id: "supabase",
    packages: { npm: ["supabase", "@supabase/supabase-js"] },
    packagePrefixes: { npm: ["@supabase/"] },
    signals: { frameworks: ["supabase"], concerns: ["backend", "database"] },
  },
  {
    id: "firebase",
    packages: { npm: ["firebase", "firebase-admin"], pypi: ["firebase-admin"] },
    packagePrefixes: { npm: ["@firebase/"] },
    signals: { frameworks: ["firebase"], concerns: ["backend", "cloud"] },
  },
  {
    id: "azure",
    packagePrefixes: { npm: ["@azure/"], pypi: ["azure-"] },
    packages: { npm: ["azure-functions"], pypi: ["azure-functions"] },
    signals: { tooling: ["azure"], concerns: ["cloud", "infrastructure"] },
  },
  {
    id: "gcp",
    packagePrefixes: { npm: ["@google-cloud/"], pypi: ["google-cloud-"] },
    packages: { npm: ["firebase-admin"], pypi: ["google-api-python-client"] },
    signals: { tooling: ["gcp"], concerns: ["cloud", "infrastructure"] },
  },
  {
    id: "aws",
    packages: { npm: ["aws-sdk", "serverless"], pypi: ["boto3", "botocore"] },
    packagePrefixes: { npm: ["@aws-sdk/"] },
    signals: { tooling: ["aws"], concerns: ["cloud", "infrastructure"] },
  },
  {
    id: "mcp",
    packages: { npm: ["@modelcontextprotocol/sdk", "modelcontextprotocol"] },
    packagePrefixes: { npm: ["@modelcontextprotocol/"] },
    signals: { concerns: ["mcp", "integration"], tooling: ["mcp"] },
  },
  {
    id: "apify",
    packages: { npm: ["apify", "crawlee"], pypi: ["apify-client"] },
    packagePrefixes: { npm: ["@apify/"] },
    textMarkers: ["apify", "actor", "webhook-debugger-logger"],
    signals: {
      frameworks: ["apify"],
      concerns: ["automation", "web-scraping"],
      tooling: ["actor", "crawler"],
    },
  },
  {
    id: "testing",
    packages: {
      npm: ["vitest", "jest", "@playwright/test", "playwright", "cypress"],
      pypi: ["pytest", "tox", "robotframework", "playwright", "selenium"],
    },
    signals: { concerns: ["testing"], tooling: ["test-runner"] },
  },
  {
    id: "data-engineering",
    packages: {
      npm: ["duckdb", "@duckdb/node-api"],
      pypi: [
        "pandas",
        "polars",
        "duckdb",
        "numpy",
        "pyspark",
        "pyarrow",
        "dbt-core",
        "apache-airflow",
        "great-expectations",
      ],
    },
    signals: { concerns: ["data", "analytics", "data-engineering"] },
  },
  {
    id: "ai-ml",
    packages: {
      npm: ["openai", "anthropic", "langchain", "genkit", "@google/genai"],
      pypi: [
        "openai",
        "anthropic",
        "langchain",
        "llama-index",
        "torch",
        "tensorflow",
        "scikit-learn",
        "transformers",
        "keras",
        "jax",
      ],
    },
    packagePrefixes: { npm: ["@langchain/"], pypi: ["langchain-"] },
    signals: { concerns: ["ai", "machine-learning"], tooling: ["ai-sdk"] },
  },
  {
    id: "deep-rl",
    packages: { pypi: ["ray", "gymnasium", "stable-baselines3", "pettingzoo"] },
    signals: { concerns: ["deep-learning", "reinforcement-learning", "ai"] },
  },
  {
    id: "robotics",
    packages: { pypi: ["rclpy", "rospy", "pymavlink"] },
    textMarkers: ["ros2", "ros", "urdf", "xacro", "robotics"],
    signals: {
      concerns: ["robotics", "systems-engineering"],
      tooling: ["ros"],
    },
  },
  {
    id: "security-pentest",
    packages: {
      pypi: [
        "cryptography",
        "pycryptodome",
        "scapy",
        "impacket",
        "pwntools",
        "paramiko",
        "semgrep",
        "bandit",
      ],
      npm: ["@snyk/cli", "eslint-plugin-security"],
    },
    textMarkers: ["pentest", "penetration test", "ctf", "threat model"],
    signals: { concerns: ["security", "cryptography", "pentesting"] },
  },
  {
    id: "blockchain",
    packages: {
      npm: ["hardhat", "ethers", "web3", "viem", "wagmi", "@solana/web3.js"],
      pypi: ["web3", "brownie", "eth-brownie", "solana"],
    },
    textMarkers: ["solidity", "smart contract", "blockchain", "web3"],
    signals: { concerns: ["blockchain", "cryptography"], tooling: ["web3"] },
  },
  {
    id: "media-creative",
    packages: {
      npm: ["remotion", "three", "tone", "wavesurfer.js", "ffmpeg-static"],
      pypi: [
        "opencv-python",
        "pillow",
        "moviepy",
        "librosa",
        "ffmpeg-python",
        "manim",
      ],
    },
    packagePrefixes: { npm: ["@react-three/"] },
    signals: { concerns: ["media", "creative-production", "design-assets"] },
  },
  {
    id: "marketing-seo",
    packages: {
      npm: ["@google-analytics/data", "googleapis"],
      pypi: [
        "google-ads",
        "facebook-business",
        "hubspot-api-client",
        "mailchimp-marketing",
      ],
    },
    textMarkers: [
      "seo",
      "marketing",
      "lead generation",
      "advertising",
      "content creation",
    ],
    signals: {
      concerns: ["marketing", "seo", "lead-generation", "content-creation"],
    },
  },
  {
    id: "frontend-extended",
    packages: {
      npm: [
        "@remix-run/react",
        "gatsby",
        "nuxt",
        "solid-js",
        "@solidjs/start",
        "@builder.io/qwik",
        "preact",
        "vite",
        "tailwindcss",
        "storybook",
        "@storybook/react",
        "@tanstack/react-query",
        "@tanstack/react-router",
        "@apollo/client",
        "graphql",
        "relay-runtime",
        "next-auth",
        "@auth/core",
        "lit",
        "electron",
        "@tauri-apps/api",
        "@capacitor/core",
      ],
    },
    packagePrefixes: {
      npm: ["@storybook/", "@tanstack/", "@tauri-apps/", "@capacitor/"],
    },
    textMarkers: [
      "remix",
      "gatsby",
      "nuxt",
      "solidstart",
      "qwik",
      "tailwind",
      "storybook",
      "graphql",
      "electron",
      "tauri",
      "capacitor",
      "web components",
      "wasm",
    ],
    signals: { concerns: ["frontend"], tooling: ["frontend-tooling"] },
  },
  {
    id: "java-backend",
    textMarkers: [
      "spring-boot",
      "org.springframework",
      "quarkus",
      "micronaut",
      "jakarta.ws.rs",
    ],
    signals: {
      languages: ["java"],
      frameworks: ["java-backend"],
      concerns: ["backend", "api-design"],
    },
  },
  {
    id: "dotnet-backend",
    textMarkers: [
      "microsoft.aspnetcore",
      "entityframeworkcore",
      "blazor",
      "targetframework",
      "microsoft.net.sdk.web",
    ],
    signals: {
      languages: ["csharp"],
      frameworks: ["dotnet-backend"],
      concerns: ["backend", "api-design"],
    },
  },
  {
    id: "go-backend",
    textMarkers: [
      "github.com/gin-gonic/gin",
      "github.com/labstack/echo",
      "github.com/gofiber/fiber",
      "github.com/go-chi/chi",
      "github.com/spf13/cobra",
    ],
    signals: {
      languages: ["go"],
      frameworks: ["go-backend"],
      concerns: ["backend", "api-design"],
    },
  },
  {
    id: "rust-backend",
    textMarkers: ["axum", "actix-web", "rocket", "tonic", "tauri"],
    signals: {
      languages: ["rust"],
      frameworks: ["rust-backend"],
      concerns: ["backend", "api-design"],
    },
  },
  {
    id: "ruby-php-elixir-backend",
    textMarkers: ["rails", "sinatra", "laravel", "symfony", "phoenix", "ecto"],
    signals: {
      concerns: ["backend", "api-design"],
      frameworks: ["backend-framework"],
    },
  },
  {
    id: "data-platforms",
    packages: {
      npm: [
        "redis",
        "kafkajs",
        "amqplib",
        "nats",
        "pg",
        "mysql2",
        "clickhouse",
      ],
      pypi: [
        "redis",
        "kafka-python",
        "pika",
        "nats-py",
        "psycopg",
        "psycopg2",
        "mysqlclient",
        "clickhouse-connect",
        "snowflake-connector-python",
      ],
    },
    textMarkers: [
      "postgres",
      "mysql",
      "redis",
      "kafka",
      "rabbitmq",
      "nats",
      "clickhouse",
      "snowflake",
      "bigquery",
      "grpc",
      "protobuf",
      "asyncapi",
    ],
    signals: {
      concerns: ["database", "data", "integration"],
      tooling: ["data-platform"],
    },
  },
  {
    id: "game-frameworks",
    packages: {
      npm: ["phaser", "pixi.js", "three", "babylonjs"],
      pypi: ["pygame", "arcade", "renpy"],
    },
    textMarkers: [
      "bevy",
      "love2d",
      "ren'py",
      "renpy",
      "unity",
      "unreal engine",
      "godot",
    ],
    signals: {
      concerns: ["game-development", "realtime-media"],
      tooling: ["game-engine"],
    },
  },
  {
    id: "design-systems",
    packages: {
      npm: [
        "style-dictionary",
        "@figma/plugin-typings",
        "figma-api",
        "token-transformer",
      ],
    },
    textMarkers: [
      "design tokens",
      "figma plugin",
      "style dictionary",
      "design system",
    ],
    signals: { concerns: ["design-systems", "design-assets", "frontend"] },
  },
  {
    id: "cad-manufacturing",
    textMarkers: [
      "freecad",
      "openscad",
      "solidworks",
      "fusion 360",
      "gerber",
      "gcode",
      "cnc",
      "slicer",
      "verilog",
      "vhdl",
      "fpga",
    ],
    signals: { concerns: ["cad", "hardware", "fabrication", "3d-printing"] },
  },
];

export function applyTechnologySignatures(
  target: DemandSignalSet,
  context: TechnologySignalContext,
): void {
  const dependencyNames = new Set(
    (context.dependencyNames ?? []).map((dependencyName) =>
      dependencyName.toLowerCase(),
    ),
  );
  const text = context.text?.toLowerCase() ?? "";

  for (const signature of TECHNOLOGY_SIGNATURES) {
    if (
      !matchesTechnologySignature(
        signature,
        context.ecosystem,
        dependencyNames,
        text,
      )
    ) {
      continue;
    }

    applySignalSet(target, signature.signals);
  }
}

function matchesTechnologySignature(
  signature: TechnologySignature,
  ecosystem: PackageEcosystem | undefined,
  dependencyNames: Set<string>,
  text: string,
): boolean {
  if (ecosystem && dependencyNames.size > 0) {
    const exactPackages = signature.packages?.[ecosystem] ?? [];
    if (
      exactPackages.some((packageName) =>
        dependencyNames.has(packageName.toLowerCase()),
      )
    ) {
      return true;
    }

    const packagePrefixes = signature.packagePrefixes?.[ecosystem] ?? [];
    if (
      [...dependencyNames].some((dependencyName) =>
        packagePrefixes.some((prefix) =>
          dependencyName.startsWith(prefix.toLowerCase()),
        ),
      )
    ) {
      return true;
    }
  }

  return (signature.textMarkers ?? []).some((marker) => text.includes(marker));
}

function applySignalSet(
  target: DemandSignalSet,
  signals: Partial<DemandSignalSet>,
): void {
  addSignals(target.languages, signals.languages ?? []);
  addSignals(target.packageManagers, signals.packageManagers ?? []);
  addSignals(target.frameworks, signals.frameworks ?? []);
  addSignals(target.concerns, signals.concerns ?? []);
  addSignals(target.tooling, signals.tooling ?? []);
}
