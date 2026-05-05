export interface DetectionFixture {
  archetype: string;
  fileName: string;
  filePath: string;
  expectedConcerns: string[];
  unexpectedConcerns?: string[];
}

export const ROADMAP_DETECTION_FIXTURES: DetectionFixture[] = [
  {
    archetype: "web-frontend",
    fileName: "README.md",
    filePath: "web/docs/frontend-readme.md",
    expectedConcerns: ["documentation", "knowledge-base"],
  },
  {
    archetype: "mobile",
    fileName: "AndroidManifest.xml",
    filePath: "apps/android/AndroidManifest.xml",
    expectedConcerns: ["mobile", "android"],
  },
  {
    archetype: "backend-api",
    fileName: "api-guide.md",
    filePath: "services/backend/docs/api-guide.md",
    expectedConcerns: ["documentation", "knowledge-base"],
  },
  {
    archetype: "infra-devops",
    fileName: "runbook.md",
    filePath: "infra/docs/runbook.md",
    expectedConcerns: ["documentation", "knowledge-base"],
  },
  {
    archetype: "ai-ml",
    fileName: "model.onnx",
    filePath: "models/model.onnx",
    expectedConcerns: ["machine-learning", "model-artifacts", "ai"],
  },
  {
    archetype: "notebooks",
    fileName: "analysis.ipynb",
    filePath: "research/notebooks/analysis.ipynb",
    expectedConcerns: ["notebooks", "data-science", "research"],
  },
  {
    archetype: "research",
    fileName: "paper.tex",
    filePath: "research/papers/paper.tex",
    expectedConcerns: ["research", "publishing", "writing"],
  },
  {
    archetype: "data-engineering",
    fileName: "events.parquet",
    filePath: "data/warehouse/events.parquet",
    expectedConcerns: ["data", "analytics", "data-engineering"],
  },
  {
    archetype: "hardware",
    fileName: "board.kicad_pcb",
    filePath: "hardware/board.kicad_pcb",
    expectedConcerns: ["cad", "hardware", "engineering"],
  },
  {
    archetype: "game-dev",
    fileName: "project.godot",
    filePath: "games/project.godot",
    expectedConcerns: ["game-development", "realtime-media"],
  },
  {
    archetype: "cad-design",
    fileName: "part.step",
    filePath: "cad/part.step",
    expectedConcerns: ["cad", "hardware", "engineering"],
  },
  {
    archetype: "media-production",
    fileName: "scene.blend",
    filePath: "design/media/scene.blend",
    expectedConcerns: ["media", "design-assets", "creative-production"],
  },
  {
    archetype: "security",
    fileName: "SECURITY.md",
    filePath: "security/SECURITY.md",
    expectedConcerns: ["documentation", "knowledge-base", "security"],
  },
  {
    archetype: "mixed-monorepo",
    fileName: "dataset.csv",
    filePath: "monorepo/packages/data/dataset.csv",
    expectedConcerns: ["data", "analytics", "data-engineering"],
  },
  {
    archetype: "trading-market-analysis",
    fileName: "breakout.pine",
    filePath: "trading/strategies/breakout.pine",
    expectedConcerns: [
      "trading",
      "market-analysis",
      "quant-finance",
      "financial-data",
      "backtesting",
    ],
  },
  {
    archetype: "bi-dashboarding",
    fileName: "sales.pbix",
    filePath: "dashboards/sales.pbix",
    expectedConcerns: [
      "business-intelligence",
      "dashboarding",
      "reporting",
      "analytics",
    ],
  },
  {
    archetype: "devops-platform",
    fileName: "ci.yml",
    filePath: ".github/workflows/ci.yml",
    expectedConcerns: [
      "devops",
      "ci-cd",
      "infrastructure",
      "platform-engineering",
    ],
  },
  {
    archetype: "security-rules",
    fileName: "detect.yara",
    filePath: "security/detections/detect.yara",
    expectedConcerns: [
      "security",
      "sast",
      "policy-as-code",
      "vulnerability-management",
      "malware-analysis",
      "reverse-engineering",
    ],
  },
  {
    archetype: "network-automation",
    fileName: "wg0.conf",
    filePath: "network/wireguard/wg0.conf",
    expectedConcerns: ["networking", "netops", "network-automation"],
  },
  {
    archetype: "mlops-model-artifact",
    fileName: "model.gguf",
    filePath: "models/model.gguf",
    expectedConcerns: ["ai", "machine-learning", "model-artifacts"],
  },
  {
    archetype: "embedded-firmware",
    fileName: "main.ino",
    filePath: "firmware/src/main.ino",
    expectedConcerns: [
      "embedded",
      "firmware",
      "rtos",
      "systems-programming",
      "hardware",
    ],
  },
  {
    archetype: "robotics-simulation",
    fileName: "test.world",
    filePath: "robotics/gazebo/test.world",
    expectedConcerns: ["robotics", "simulation"],
  },
  {
    archetype: "blockchain-smart-contracts",
    fileName: "Anchor.toml",
    filePath: "blockchain/solana/Anchor.toml",
    expectedConcerns: ["blockchain", "cryptography", "smart-contracts", "defi"],
  },
  {
    archetype: "data-mining-engineering",
    fileName: "pipeline.py",
    filePath: "pipelines/data-mining/pipeline.py",
    expectedConcerns: [
      "data",
      "data-engineering",
      "data-mining",
      "etl",
      "analytics-engineering",
    ],
  },
  {
    archetype: "slicer-printing",
    fileName: "printer.cfg",
    filePath: "klipper/printer.cfg",
    expectedConcerns: [
      "3d-printing",
      "fabrication",
      "hardware",
      "slicer",
      "additive-manufacturing",
    ],
  },
  {
    archetype: "technical-seo",
    fileName: "robots.txt",
    filePath: "public/robots.txt",
    expectedConcerns: ["seo"],
  },
  {
    archetype: "seo-content-cms",
    fileName: "sitemap.xml",
    filePath: "content-marketing/cms/sitemap.xml",
    expectedConcerns: ["seo", "content-creation", "content-marketing", "cms"],
  },
];
