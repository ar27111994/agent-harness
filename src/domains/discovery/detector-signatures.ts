import type { DemandSignalSet } from "../../types.js";

/**
 * Defines the supported detector signal set values.
 */
export type DetectorSignalSet = Partial<DemandSignalSet>;

/**
 * Describes detector conditional signals data exchanged by the lifecycle pipeline.
 */
export interface DetectorConditionalSignals {
  fileNamePattern?: RegExp;
  filePathPattern?: RegExp;
  signals: DetectorSignalSet;
}

/**
 * Describes detector signature data exchanged by the lifecycle pipeline.
 */
export interface DetectorSignature {
  id: string;
  extensions?: string[];
  fileNames?: string[];
  filePathPattern?: RegExp;
  signals: DetectorSignalSet;
  conditionalSignals?: DetectorConditionalSignals[];
}

/**
 * Defines detector signatures shared by the lifecycle pipeline.
 */
export const DETECTOR_SIGNATURES: DetectorSignature[] = [
  {
    id: "documentation",
    extensions: [".md", ".mdx", ".rst", ".adoc"],
    signals: {
      concerns: ["documentation", "knowledge-base"],
    },
    conditionalSignals: [
      {
        filePathPattern: /research|paper|notes?|content/iu,
        signals: { concerns: ["research", "writing"] },
      },
      {
        filePathPattern: /security|threat|audit|compliance/iu,
        signals: { concerns: ["security"] },
      },
    ],
  },
  {
    id: "notebook",
    extensions: [".ipynb"],
    signals: {
      languages: ["python"],
      concerns: ["notebooks", "data-science", "research"],
      tooling: ["jupyter", "pypi:jupyter", "pypi:ipykernel"],
    },
  },
  {
    id: "dataset",
    extensions: [
      ".csv",
      ".tsv",
      ".parquet",
      ".arrow",
      ".orc",
      ".avro",
      ".jsonl",
      ".sqlite",
      ".duckdb",
    ],
    signals: {
      concerns: ["data", "analytics"],
      tooling: ["pypi:pandas", "pypi:duckdb"],
    },
    conditionalSignals: [
      {
        filePathPattern: /warehouse|etl|pipeline|lake|dataset|data/iu,
        signals: { concerns: ["data-engineering"] },
      },
    ],
  },
  {
    id: "media-design",
    extensions: [
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
      ".svg",
      ".xd",
      ".afdesign",
      ".afphoto",
      ".aseprite",
      ".mid",
      ".midi",
      ".als",
      ".flp",
      ".logicx",
      ".aup3",
      ".prproj",
      ".aep",
      ".fcpxml",
      ".nk",
      ".drp",
      ".ma",
      ".mb",
      ".c4d",
      ".hip",
      ".usd",
      ".usdz",
      ".obj",
      ".mtl",
    ],
    signals: {
      concerns: ["media", "design-assets", "creative-production"],
      tooling: ["asset-pipeline"],
    },
  },
  {
    id: "engineering-artifacts",
    extensions: [
      ".stl",
      ".step",
      ".stp",
      ".iges",
      ".igs",
      ".dwg",
      ".dxf",
      ".fcstd",
      ".scad",
      ".f3d",
      ".sldprt",
      ".sldasm",
      ".ipt",
      ".iam",
      ".gerber",
      ".gbr",
      ".drl",
      ".nc",
      ".kicad_pcb",
      ".kicad_sch",
      ".brd",
      ".sch",
      ".sv",
      ".vhd",
      ".vhdl",
      ".xdc",
    ],
    signals: {
      concerns: ["cad", "hardware", "engineering"],
      tooling: ["cad"],
    },
  },
  {
    id: "game-engine",
    extensions: [
      ".unity",
      ".uproject",
      ".uplugin",
      ".godot",
      ".tscn",
      ".tres",
      ".gd",
      ".prefab",
      ".mat",
      ".uasset",
      ".umap",
    ],
    fileNames: [
      "project.godot",
      "ProjectVersion.txt",
      "Game.project",
      "RenPy.app",
    ],
    signals: {
      concerns: ["game-development", "realtime-media"],
      tooling: ["game-engine"],
    },
    conditionalSignals: [
      {
        fileNamePattern: /\.godot$/iu,
        signals: { tooling: ["godot"] },
      },
    ],
  },
  {
    id: "research",
    extensions: [".bib", ".tex", ".qmd", ".rmd"],
    signals: {
      concerns: ["research", "publishing", "writing"],
      tooling: ["latex"],
    },
  },
  {
    id: "ml-artifact",
    extensions: [".onnx", ".safetensors", ".pt", ".pth", ".h5"],
    signals: {
      concerns: ["machine-learning", "model-artifacts", "ai"],
      tooling: ["pypi:torch", "pypi:tensorflow"],
    },
  },
  {
    id: "mobile",
    fileNames: [
      "Podfile",
      "AndroidManifest.xml",
      "Info.plist",
      "project.pbxproj",
    ],
    filePathPattern: /(^|[/\\])(ios|android|mobile|xamarin|maui)([/\\]|$)/iu,
    signals: {
      concerns: ["mobile"],
    },
    conditionalSignals: [
      {
        fileNamePattern: /^(Podfile|Info\.plist|project\.pbxproj)$/iu,
        filePathPattern: /(^|[/\\])(ios|iphone|ipad)([/\\]|$)/iu,
        signals: { concerns: ["ios"], tooling: ["ios", "xcode"] },
      },
      {
        fileNamePattern: /^AndroidManifest\.xml$/iu,
        filePathPattern: /(^|[/\\])android([/\\]|$)/iu,
        signals: { concerns: ["android"], tooling: ["android"] },
      },
      {
        filePathPattern: /(^|[/\\])maui([/\\]|$)/iu,
        signals: { frameworks: ["maui"], tooling: ["dotnet-maui"] },
      },
      {
        filePathPattern: /(^|[/\\])xamarin([/\\]|$)/iu,
        signals: { frameworks: ["xamarin"], tooling: ["xamarin"] },
      },
    ],
  },
  {
    id: "robotics",
    extensions: [".urdf", ".xacro", ".rviz", ".launch"],
    fileNames: ["package.xml", "CMakeLists.txt"],
    filePathPattern: /(^|[/\\])(ros|ros2|robot|robotics|urdf)([/\\]|$)/iu,
    signals: {
      concerns: ["robotics", "systems-engineering"],
      tooling: ["ros"],
    },
  },
  {
    id: "security-networking",
    extensions: [".pcap", ".pcapng", ".nessus", ".burp", ".nmap"],
    filePathPattern: /(^|[/\\])(pentest|network|pcap|threat)([/\\]|$)/iu,
    signals: {
      concerns: ["security", "pentesting", "networking"],
    },
  },
  {
    id: "blockchain",
    extensions: [".sol", ".vy"],
    fileNames: ["hardhat.config.js", "hardhat.config.ts", "foundry.toml"],
    signals: {
      concerns: ["blockchain", "cryptography"],
      tooling: ["web3"],
    },
  },
  {
    id: "business-analysis",
    extensions: [".bpmn", ".drawio", ".docx", ".pptx", ".xlsx"],
    filePathPattern:
      /(^|[/\\])(analysis|business|requirements|process)([/\\]|$)/iu,
    signals: {
      concerns: ["business-analysis", "documentation"],
    },
  },
  {
    id: "fabrication-3d-printing",
    extensions: [".gcode", ".3mf"],
    filePathPattern:
      /(^|[/\\])(3d-print|printing|fabrication|slicer)([/\\]|$)/iu,
    signals: {
      concerns: ["3d-printing", "fabrication", "hardware"],
    },
  },
  {
    id: "design-system",
    filePathPattern: /(^|[/\\])(design-system|design|tokens?)([/\\]|$)/iu,
    signals: {
      concerns: ["design-systems", "design-assets", "frontend"],
    },
  },
  {
    id: "marketing-content",
    filePathPattern:
      /(^|[/\\])(marketing|seo|content|ads|advertising|lead-gen|leads)([/\\]|$)/iu,
    signals: {
      concerns: ["marketing", "seo", "content-creation", "lead-generation"],
    },
  },
];
