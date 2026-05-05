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
];
