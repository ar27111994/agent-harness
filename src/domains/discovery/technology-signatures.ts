import type { DemandSignalSet } from "../../types.js";
import { addSignals } from "./signals.js";

/**
 * Defines the supported package ecosystem values.
 */
export type PackageEcosystem =
  | "npm"
  | "pypi"
  | "pub"
  | "cargo"
  | "go"
  | "maven"
  | "nuget"
  | "gem"
  | "packagist"
  | "swift";

/**
 * Describes technology signature data exchanged by the lifecycle pipeline.
 */
export interface TechnologySignature {
  id: string;
  packages?: Partial<Record<PackageEcosystem, string[]>>;
  packagePrefixes?: Partial<Record<PackageEcosystem, string[]>>;
  textMarkers?: string[];
  signals: Partial<DemandSignalSet>;
}

/**
 * Describes technology signal context data exchanged by the lifecycle pipeline.
 */
export interface TechnologySignalContext {
  dependencyNames?: string[];
  ecosystem?: PackageEcosystem;
  text?: string;
}

const textMarkerPatternCache = new Map<string, RegExp>();

/**
 * Defines technology signatures shared by the lifecycle pipeline.
 */
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
      pypi: ["sqlalchemy", "alembic"],
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
    packages: {
      npm: ["firebase", "firebase-admin", "@firebase/app"],
      pypi: ["firebase-admin"],
      pub: [
        "firebase_core",
        "firebase_auth",
        "firebase_database",
        "firebase_messaging",
        "firebase_storage",
        "cloud_firestore",
      ],
    },
    packagePrefixes: { npm: ["@firebase/", "firebase-"], pub: ["firebase_"] },
    signals: {
      frameworks: ["firebase"],
      concerns: ["backend", "cloud", "database", "authentication"],
    },
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
    id: "flutter",
    packages: { pub: ["flutter"] },
    packagePrefixes: { pub: ["flutter_"] },
    textMarkers: ["flutter"],
    signals: {
      languages: ["dart"],
      frameworks: ["flutter"],
      concerns: ["mobile", "frontend"],
      tooling: ["flutter", "pub"],
    },
  },
  {
    id: "dart",
    packages: { pub: ["dart"] },
    signals: {
      languages: ["dart"],
      packageManagers: ["pub"],
      tooling: ["dart"],
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
    textMarkers: [
      "ros2",
      "ros",
      "urdf",
      "xacro",
      "robotics",
      "ament_cmake",
      "catkin",
      "rclcpp",
      "sensor_msgs",
      "geometry_msgs",
    ],
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
    id: "finance-trading",
    packages: {
      npm: ["ccxt", "technicalindicators", "lightweight-charts"],
      pypi: [
        "ccxt",
        "backtrader",
        "yfinance",
        "ta-lib",
        "vectorbt",
        "zipline-reloaded",
        "quantlib",
        "alpaca-py",
        "ib-insync",
      ],
    },
    textMarkers: [
      "forex",
      "stock trading",
      "market analysis",
      "backtesting",
      "quant finance",
      "portfolio analytics",
    ],
    signals: {
      concerns: [
        "trading",
        "market-analysis",
        "quant-finance",
        "financial-data",
        "backtesting",
      ],
      tooling: ["backtesting"],
    },
  },
  {
    id: "bi-dashboarding",
    packages: {
      npm: ["powerbi-client", "@superset-ui/core", "vega-lite"],
      pypi: [
        "streamlit",
        "dash",
        "plotly",
        "apache-superset",
        "metabase-api",
        "shiny",
      ],
    },
    textMarkers: [
      "business intelligence",
      "power bi",
      "tableau",
      "looker",
      "dashboarding",
      "reporting",
    ],
    signals: {
      concerns: ["business-intelligence", "dashboarding", "reporting"],
    },
  },
  {
    id: "power-bi",
    packages: { npm: ["powerbi-client"] },
    textMarkers: ["power bi"],
    signals: {
      concerns: ["business-intelligence"],
      tooling: ["power-bi"],
    },
  },
  {
    id: "devops-platform",
    packages: {
      npm: ["@pulumi/pulumi", "aws-cdk-lib", "cdk8s", "serverless"],
      pypi: ["ansible", "kubernetes", "docker", "pulumi"],
    },
    packagePrefixes: { npm: ["@pulumi/"], pypi: ["apache-airflow-providers-"] },
    textMarkers: [
      "github actions",
      "gitlab ci",
      "jenkinsfile",
      "kubernetes",
      "helm",
      "ansible",
      "pulumi",
      "platform engineering",
    ],
    signals: {
      concerns: ["devops", "ci-cd", "infrastructure", "platform-engineering"],
    },
  },
  {
    id: "ansible",
    packages: { pypi: ["ansible"] },
    textMarkers: ["ansible"],
    signals: {
      concerns: ["devops", "infrastructure"],
      tooling: ["ansible"],
    },
  },
  {
    id: "kubernetes",
    packages: { npm: ["cdk8s"], pypi: ["kubernetes"] },
    textMarkers: ["kubernetes"],
    signals: {
      concerns: ["devops", "infrastructure"],
      tooling: ["kubernetes"],
    },
  },
  {
    id: "pulumi",
    packages: { npm: ["@pulumi/pulumi"], pypi: ["pulumi"] },
    packagePrefixes: { npm: ["@pulumi/"] },
    textMarkers: ["pulumi"],
    signals: {
      concerns: ["devops", "infrastructure"],
      tooling: ["pulumi"],
    },
  },
  {
    id: "security-advanced",
    packages: {
      npm: ["snyk", "eslint-plugin-security"],
      pypi: [
        "yara-python",
        "volatility3",
        "frida-tools",
        "angr",
        "z3-solver",
        "mitmproxy",
        "python-owasp-zap-v2.4",
        "detect-secrets",
      ],
    },
    textMarkers: [
      "secret scanning",
      "container security",
      "policy as code",
      "malware analysis",
      "reverse engineering",
      "osint",
      "vulnerability management",
    ],
    signals: {
      concerns: [
        "security",
        "sast",
        "secret-scanning",
        "policy-as-code",
        "malware-analysis",
        "reverse-engineering",
        "osint",
        "vulnerability-management",
      ],
    },
  },
  {
    id: "network-automation",
    packages: {
      npm: ["mqtt", "dns2"],
      pypi: [
        "pyshark",
        "dnspython",
        "napalm",
        "netmiko",
        "ncclient",
        "nornir",
        "pyroute2",
      ],
    },
    textMarkers: [
      "network automation",
      "netops",
      "wireguard",
      "routing",
      "firewall",
      "packet analysis",
    ],
    signals: {
      concerns: ["networking", "netops", "network-automation"],
    },
  },
  {
    id: "classic-ml",
    packages: {
      pypi: ["xgboost", "lightgbm", "catboost"],
    },
    signals: { concerns: ["machine-learning"] },
  },
  {
    id: "mlops",
    packages: {
      pypi: ["mlflow", "wandb", "optuna", "dvc", "huggingface-hub", "datasets"],
    },
    textMarkers: ["mlops", "model evaluation"],
    signals: {
      concerns: [
        "machine-learning",
        "mlops",
        "model-training",
        "model-evaluation",
      ],
    },
  },
  {
    id: "model-serving",
    packages: {
      npm: ["@tensorflow/tfjs", "onnxruntime-node"],
      pypi: ["accelerate", "peft"],
    },
    textMarkers: ["model serving"],
    signals: {
      concerns: ["machine-learning", "deep-learning", "model-serving"],
    },
  },
  {
    id: "rag-vector-search",
    packages: {
      npm: ["chromadb", "langgraph"],
      pypi: [
        "sentence-transformers",
        "faiss-cpu",
        "chromadb",
        "weaviate-client",
      ],
    },
    packagePrefixes: { npm: ["@xenova/"] },
    textMarkers: ["vector search", "retrieval augmented generation", "rag"],
    signals: {
      concerns: [
        "machine-learning",
        "deep-learning",
        "rag",
        "vector-search",
        "nlp",
      ],
    },
  },
  {
    id: "computer-vision-nlp",
    packages: {
      pypi: ["ultralytics", "timm", "spacy"],
    },
    textMarkers: ["computer vision", "nlp"],
    signals: {
      concerns: ["machine-learning", "deep-learning", "computer-vision", "nlp"],
    },
  },
  {
    id: "creative-media-extended",
    packages: {
      npm: ["@ffmpeg/ffmpeg", "sharp", "jimp", "fabric", "paper", "p5"],
      pypi: [
        "pydub",
        "soundfile",
        "mido",
        "pretty-midi",
        "music21",
        "aubio",
        "openimageio",
        "trimesh",
        "bpy",
        "moderngl",
      ],
    },
    textMarkers: [
      "audio production",
      "video production",
      "generative art",
      "image processing",
      "motion graphics",
      "vfx",
    ],
    signals: {
      concerns: [
        "media",
        "audio-production",
        "music",
        "video-production",
        "vfx",
        "image-processing",
        "generative-art",
        "3d-assets",
      ],
    },
  },
  {
    id: "embedded-systems",
    packages: {
      npm: ["johnny-five"],
      pypi: ["platformio", "esptool", "adafruit-circuitpython", "pyserial"],
      cargo: ["embedded-hal", "cortex-m", "rtic", "probe-rs", "esp-idf-svc"],
    },
    textMarkers: [
      "embedded",
      "firmware",
      "rtos",
      "zephyr",
      "esp-idf",
      "platformio",
      "arduino",
      "kernel driver",
    ],
    signals: {
      concerns: [
        "embedded",
        "firmware",
        "rtos",
        "systems-programming",
        "hardware",
        "iot",
      ],
    },
  },
  {
    id: "robotics-simulation",
    packages: {
      npm: ["roslib", "rclnodejs"],
      pypi: [
        "rosbags",
        "roslibpy",
        "dronekit",
        "pybullet",
        "mujoco",
        "webots",
        "gymnasium-robotics",
      ],
    },
    textMarkers: [
      "gazebo",
      "webots",
      "moveit",
      "nav2",
      "slam",
      "mavlink",
      "autonomy",
      "drone",
    ],
    signals: {
      concerns: [
        "robotics",
        "simulation",
        "slam",
        "motion-planning",
        "autonomy",
        "drones",
      ],
    },
  },
  {
    id: "blockchain-extended",
    packages: {
      npm: [
        "@coral-xyz/anchor",
        "@openzeppelin/contracts",
        "truffle",
        "ganache",
        "@wagmi/core",
      ],
      pypi: ["eth-ape", "vyper", "py-solc-x", "bitcoinlib"],
      cargo: [
        "anchor-lang",
        "solana-program",
        "ink",
        "cosmwasm-std",
        "near-sdk",
        "ethers",
      ],
    },
    textMarkers: [
      "smart contracts",
      "defi",
      "solana",
      "substrate",
      "cosmwasm",
      "cairo",
      "move language",
    ],
    signals: {
      concerns: ["blockchain", "smart-contracts", "defi", "wallet"],
      tooling: ["ethereum", "solana", "move", "cairo", "substrate", "cosmwasm"],
    },
  },
  {
    id: "data-mining-platforms",
    packages: {
      npm: ["apache-arrow", "danfojs-node", "arquero"],
      pypi: [
        "dlt",
        "prefect",
        "dagster",
        "scrapy",
        "beautifulsoup4",
        "lxml",
        "sqlfluff",
      ],
    },
    packagePrefixes: { pypi: ["dbt-"] },
    textMarkers: [
      "data mining",
      "analytics engineering",
      "data quality",
      "lakehouse",
      "orchestration",
      "streaming",
    ],
    signals: {
      concerns: [
        "data",
        "data-engineering",
        "data-mining",
        "etl",
        "elt",
        "analytics-engineering",
        "orchestration",
        "data-quality",
        "streaming",
        "lakehouse",
      ],
    },
  },
  {
    id: "cad-printing-extended",
    packages: {
      npm: ["@jscad/modeling", "jscad"],
      pypi: [
        "cadquery",
        "solidpython",
        "trimesh",
        "numpy-stl",
        "pyvista",
        "open3d",
      ],
    },
    textMarkers: [
      "cadquery",
      "additive manufacturing",
      "klipper",
      "slicer",
      "cnc",
    ],
    signals: {
      concerns: [
        "cad",
        "3d-printing",
        "fabrication",
        "additive-manufacturing",
        "cnc",
      ],
      tooling: ["slicer", "klipper"],
    },
  },
  {
    id: "seo-technical",
    packages: {
      npm: ["next-seo", "next-sitemap", "@nuxtjs/seo"],
      pypi: ["google-analytics-data"],
    },
    textMarkers: ["technical seo"],
    signals: {
      concerns: ["seo"],
    },
  },
  {
    id: "content-cms",
    packages: {
      npm: ["contentlayer", "@sanity/client"],
      pypi: ["python-frontmatter", "pelican"],
    },
    textMarkers: [
      "content marketing",
      "cms",
      "editorial calendar",
      "landing pages",
      "copywriting",
      "campaigns",
    ],
    signals: {
      concerns: ["content-creation", "content-marketing", "cms", "blog"],
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
    id: "monorepo-build-systems",
    packages: {
      npm: ["nx", "turbo", "@microsoft/rush", "lage", "@bazel/bazelisk"],
    },
    packagePrefixes: { npm: ["@nx/", "@nrwl/"] },
    textMarkers: ["turborepo", "pnpm-workspace", "yarn workspaces"],
    signals: {
      concerns: ["monorepo", "build-orchestration"],
      tooling: ["nx", "turborepo", "rush", "bazel"],
    },
  },
  {
    id: "serverless-edge-platforms",
    packages: {
      npm: [
        "wrangler",
        "@cloudflare/workers-types",
        "vercel",
        "netlify-cli",
        "sst",
        "serverless",
        "firebase-functions",
      ],
      pypi: [
        "azure-functions",
        "google-cloud-functions",
        "functions-framework",
      ],
    },
    packagePrefixes: { npm: ["@vercel/", "@netlify/", "@cloudflare/"] },
    textMarkers: [
      "cloudflare workers",
      "vercel edge",
      "netlify functions",
      "aws lambda",
      "deno deploy",
      "cloud run",
    ],
    signals: {
      concerns: ["serverless", "edge", "cloud", "infrastructure"],
      tooling: ["cloudflare", "vercel", "netlify", "lambda"],
    },
  },
  {
    id: "cross-platform-mobile",
    packages: {
      npm: [
        "react-native",
        "expo",
        "ionic",
        "@capacitor/core",
        "@react-native-community/cli",
      ],
      maven: [
        "org.jetbrains.kotlin.multiplatform:org.jetbrains.kotlin.multiplatform.gradle.plugin",
      ],
    },
    packagePrefixes: {
      npm: ["@react-native/", "@expo/", "@ionic/", "@capacitor/"],
    },
    textMarkers: ["react native", "swiftui", "kotlin multiplatform"],
    signals: {
      concerns: ["mobile", "frontend"],
      tooling: ["react-native", "expo", "ionic", "capacitor", "swiftui"],
    },
  },
  {
    id: "agentic-ai-frameworks",
    packages: {
      npm: ["ai", "mastra", "langgraph", "@genkit-ai/core"],
      pypi: [
        "langgraph",
        "crewai",
        "pyautogen",
        "semantic-kernel",
        "haystack-ai",
        "dspy-ai",
        "genkit",
      ],
    },
    packagePrefixes: { npm: ["@ai-sdk/", "@mastra/"], pypi: ["llama-index"] },
    textMarkers: ["ai agent", "agentic workflow", "vercel ai sdk"],
    signals: {
      concerns: ["ai", "ai-agent", "rag", "model-serving"],
      tooling: ["ai-sdk", "langgraph", "crewai", "semantic-kernel"],
    },
  },
  {
    id: "commerce-cms-platforms",
    packages: {
      npm: [
        "@shopify/shopify-api",
        "@shopify/hydrogen",
        "@strapi/strapi",
        "payload",
        "directus",
        "@sanity/client",
        "contentful",
      ],
      packagist: [
        "magento/product-community-edition",
        "automattic/woocommerce",
      ],
    },
    packagePrefixes: { npm: ["@shopify/", "@strapi/", "@payloadcms/"] },
    textMarkers: ["shopify", "magento", "adobe commerce", "woocommerce"],
    signals: {
      concerns: ["commerce", "cms", "content-creation"],
      tooling: ["shopify", "strapi", "payload-cms", "directus", "contentful"],
    },
  },
  {
    id: "workflow-orchestration",
    packages: {
      npm: ["@temporalio/client", "@temporalio/worker", "kafkajs"],
      pypi: [
        "airbyte",
        "meltano",
        "dagster",
        "prefect",
        "temporalio",
        "apache-flink",
      ],
    },
    packagePrefixes: { pypi: ["dbt-"] },
    textMarkers: ["workflow orchestration", "airbyte", "meltano", "temporal"],
    signals: {
      concerns: [
        "data-engineering",
        "orchestration",
        "workflow-orchestration",
        "streaming",
      ],
      tooling: ["airbyte", "meltano", "dagster", "prefect", "temporal"],
    },
  },
  {
    id: "desktop-apps",
    packages: {
      npm: ["electron", "@tauri-apps/api"],
      go: ["github.com/wailsapp/wails/v2"],
      nuget: ["Avalonia", "Avalonia.Controls", "Microsoft.Maui.Controls"],
    },
    packagePrefixes: { npm: ["@electron/", "@tauri-apps/"] },
    textMarkers: ["desktop app", "tauri", "wails", "avalonia", "qt"],
    signals: {
      concerns: ["desktop", "frontend"],
      tooling: ["electron", "tauri", "wails", "avalonia", "qt"],
    },
  },
  {
    id: "java-backend",
    packages: {
      maven: [
        "org.springframework.boot:spring-boot-starter-web",
        "io.quarkus:quarkus-resteasy-reactive",
        "io.micronaut:micronaut-http-server-netty",
      ],
    },
    packagePrefixes: {
      maven: ["org.springframework.boot:", "io.quarkus:", "io.micronaut:"],
    },
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
    packages: {
      nuget: [
        "Microsoft.AspNetCore.App",
        "Microsoft.AspNetCore.Mvc.Core",
        "Microsoft.EntityFrameworkCore",
      ],
    },
    packagePrefixes: {
      nuget: ["Microsoft.AspNetCore.", "Microsoft.EntityFrameworkCore"],
    },
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
    packages: {
      go: [
        "github.com/gin-gonic/gin",
        "github.com/labstack/echo",
        "github.com/gofiber/fiber",
        "github.com/go-chi/chi",
        "github.com/spf13/cobra",
      ],
    },
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
    packages: { cargo: ["axum", "actix-web", "rocket", "tonic", "tauri"] },
    textMarkers: ["axum", "actix-web", "rocket", "tonic", "tauri"],
    signals: {
      languages: ["rust"],
      frameworks: ["rust-backend"],
      concerns: ["backend", "api-design"],
    },
  },
  {
    id: "ruby-backend",
    packages: { gem: ["rails", "sinatra", "hanami", "roda", "grape"] },
    textMarkers: ["rails", "sinatra", "hanami", "roda"],
    signals: {
      languages: ["ruby"],
      concerns: ["backend", "api-design"],
      frameworks: ["backend-framework"],
    },
  },
  {
    id: "php-backend",
    packages: {
      packagist: [
        "laravel/framework",
        "symfony/symfony",
        "symfony/framework-bundle",
        "codeigniter4/framework",
        "laminas/laminas-mvc",
        "zendframework/zendframework",
        "cakephp/cakephp",
        "yiisoft/yii2",
        "slim/slim",
      ],
    },
    textMarkers: [
      "laravel",
      "symfony",
      "codeigniter",
      "laminas",
      "zend framework",
      "cakephp",
      "yii2",
      "slim framework",
    ],
    signals: {
      languages: ["php"],
      concerns: ["backend", "api-design"],
      frameworks: ["backend-framework"],
    },
  },
  {
    id: "php-cms",
    packages: {
      packagist: [
        "drupal/core",
        "roots/wordpress",
        "johnpbloch/wordpress",
        "wp-cli/wp-cli",
        "automattic/woocommerce",
        "joomla/joomla-cms",
      ],
    },
    packagePrefixes: {
      packagist: ["wpackagist-plugin/", "wpackagist-theme/", "drupal/"],
    },
    textMarkers: ["wordpress", "drupal", "joomla", "woocommerce"],
    signals: {
      languages: ["php"],
      concerns: ["backend", "cms"],
      tooling: ["wordpress", "drupal", "joomla"],
    },
  },
  {
    id: "elixir-backend",
    textMarkers: ["phoenix", "ecto", "plug", "mix.exs"],
    signals: {
      languages: ["elixir"],
      concerns: ["backend", "api-design"],
      frameworks: ["backend-framework"],
    },
  },
  {
    id: "erlang-backend",
    textMarkers: ["cowboy", "rebar.config", "otp application"],
    signals: {
      languages: ["erlang"],
      concerns: ["backend", "systems-programming"],
      frameworks: ["backend-framework"],
    },
  },
  {
    id: "julia-computing",
    textMarkers: ["julia", "dataframes", "flux.jl", "makie", "pluto notebook"],
    signals: {
      languages: ["julia"],
      concerns: ["data", "analytics", "scientific-computing"],
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
        "@penpot/mcp",
      ],
    },
    textMarkers: [
      "design tokens",
      "design-source",
      "figma plugin",
      "machine-readable design system",
      "penpot",
      "penpot mcp",
      "penpot mrds",
      "style dictionary",
      "design system",
    ],
    signals: {
      concerns: [
        "design-systems",
        "design-assets",
        "frontend",
        "frontend-design",
        "design-source",
        "design-mcp",
        "penpot",
        "penpot-mrds",
      ],
      tooling: ["design-system"],
    },
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

/**
 * Provides apply technology signatures for the lifecycle pipeline.
 */
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

  return (signature.textMarkers ?? []).some((marker) =>
    matchesTextMarker(text, marker),
  );
}

function matchesTextMarker(text: string, marker: string): boolean {
  const normalizedMarker = marker.trim().toLowerCase();
  if (!normalizedMarker) {
    return false;
  }

  return buildDelimitedMarkerPattern(normalizedMarker).test(text);
}

function buildDelimitedMarkerPattern(marker: string): RegExp {
  const cachedPattern = textMarkerPatternCache.get(marker);
  if (cachedPattern) {
    return cachedPattern;
  }

  const escapedMarker = escapeRegExp(marker).replace(/\s+/gu, "\\s+");
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapedMarker}([^a-z0-9]|$)`,
    "iu",
  );
  textMarkerPatternCache.set(marker, pattern);
  return pattern;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
