import { extname } from "node:path";

import type { DemandSignalSet } from "../../types.js";

export interface FileDetector {
  id: string;
  matches(fileName: string, filePath: string): boolean;
  applySignals(
    target: DemandSignalSet,
    fileName: string,
    filePath: string,
  ): void;
}

const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".adoc"]);
const NOTEBOOK_EXTENSIONS = new Set([".ipynb"]);
const DATA_EXTENSIONS = new Set([
  ".csv",
  ".tsv",
  ".parquet",
  ".arrow",
  ".orc",
  ".avro",
  ".jsonl",
  ".sqlite",
  ".duckdb",
]);
const MEDIA_EXTENSIONS = new Set([
  ".psd",
  ".ai",
  ".fig",
  ".sketch",
  ".blend",
  ".fbx",
  ".glb",
  ".gltf",
  ".wav",
  ".mp3",
  ".flac",
  ".mp4",
  ".mov",
  ".srt",
]);
const ENGINEERING_EXTENSIONS = new Set([
  ".stl",
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".dwg",
  ".dxf",
  ".kicad_pcb",
  ".kicad_sch",
  ".brd",
  ".sch",
]);
const GAME_EXTENSIONS = new Set([".unity", ".uproject", ".uplugin", ".godot"]);
const RESEARCH_EXTENSIONS = new Set([".bib", ".tex", ".qmd", ".rmd"]);
const ML_EXTENSIONS = new Set([".onnx", ".safetensors", ".pt", ".pth", ".h5"]);

export const FILE_DETECTORS: FileDetector[] = [
  {
    id: "documentation",
    matches: (fileName) =>
      DOCUMENTATION_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target, _fileName, filePath) => {
      addSignals(target.concerns, ["documentation", "knowledge-base"]);
      if (/research|paper|notes?|docs?|content/iu.test(filePath)) {
        addSignals(target.concerns, ["research", "writing"]);
      }
    },
  },
  {
    id: "notebook",
    matches: (fileName) =>
      NOTEBOOK_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target) => {
      addSignals(target.languages, ["python"]);
      addSignals(target.concerns, ["notebooks", "data-science", "research"]);
      addSignals(target.tooling, ["jupyter"]);
      addSignals(target.tooling, ["pypi:jupyter", "pypi:ipykernel"]);
    },
  },
  {
    id: "dataset",
    matches: (fileName) => DATA_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target, _fileName, filePath) => {
      addSignals(target.concerns, ["data", "analytics"]);
      if (/warehouse|etl|pipeline|lake|dataset|data/iu.test(filePath)) {
        addSignals(target.concerns, ["data-engineering"]);
      }
      addSignals(target.tooling, ["pypi:pandas", "pypi:duckdb"]);
    },
  },
  {
    id: "media-design",
    matches: (fileName) =>
      MEDIA_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target) => {
      addSignals(target.concerns, [
        "media",
        "design-assets",
        "creative-production",
      ]);
      addSignals(target.tooling, ["asset-pipeline"]);
    },
  },
  {
    id: "engineering-artifacts",
    matches: (fileName) =>
      ENGINEERING_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target) => {
      addSignals(target.concerns, ["cad", "hardware", "engineering"]);
      addSignals(target.tooling, ["cad"]);
    },
  },
  {
    id: "game-engine",
    matches: (fileName) => GAME_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target, fileName) => {
      addSignals(target.concerns, ["game-development", "realtime-media"]);
      addSignals(target.tooling, [
        fileName.endsWith(".godot") ? "godot" : "game-engine",
      ]);
    },
  },
  {
    id: "research",
    matches: (fileName) =>
      RESEARCH_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target) => {
      addSignals(target.concerns, ["research", "publishing", "writing"]);
      addSignals(target.tooling, ["latex"]);
    },
  },
  {
    id: "ml-artifact",
    matches: (fileName) => ML_EXTENSIONS.has(extname(fileName).toLowerCase()),
    applySignals: (target) => {
      addSignals(target.concerns, [
        "machine-learning",
        "model-artifacts",
        "ai",
      ]);
      addSignals(target.tooling, ["pypi:torch", "pypi:tensorflow"]);
    },
  },
  {
    id: "mobile",
    matches: (fileName, filePath) =>
      fileName === "pubspec.yaml" ||
      fileName === "Podfile" ||
      fileName === "AndroidManifest.xml" ||
      /(^|[/\\])(ios|android)([/\\]|$)/u.test(filePath),
    applySignals: (target) => {
      addSignals(target.concerns, ["mobile"]);
      addSignals(target.tooling, ["android", "ios"]);
    },
  },
];

export function isDetectorInspectableFile(
  fileName: string,
  filePath: string,
): boolean {
  return FILE_DETECTORS.some((detector) =>
    detector.matches(fileName, filePath),
  );
}

export function collectDetectorSignals(
  fileName: string,
  filePath: string,
  target: DemandSignalSet,
): void {
  for (const detector of FILE_DETECTORS) {
    if (detector.matches(fileName, filePath)) {
      target.tooling.push(`detector:${detector.id}`);
      detector.applySignals(target, fileName, filePath);
    }
  }
}

function addSignals(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}
