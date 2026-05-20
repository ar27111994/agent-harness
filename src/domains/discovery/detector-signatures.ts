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
    filePathPattern: /(^|[/\\])(ros|ros2|robot|robotics|urdf)([/\\]|$)/iu,
    signals: {
      concerns: ["robotics", "systems-engineering"],
      tooling: ["ros"],
    },
  },
  {
    id: "security-networking",
    extensions: [".pcap", ".pcapng", ".nessus", ".burp", ".nmap"],
    filePathPattern: /(^|[/\\])(pentest|pcap|threat|forensics|ctf)([/\\]|$)/iu,
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
    filePathPattern: /(^|[/\\])(analysis|business|process)([/\\]|$)/iu,
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
    conditionalSignals: [
      {
        fileNamePattern:
          /(^|[/\\])penpot(?:[-_]?mrds)?\.(?:md|mdx|json|ya?ml)$/iu,
        signals: {
          concerns: [
            "design-source",
            "design-mcp",
            "frontend-design",
            "penpot",
            "penpot-mrds",
          ],
          tooling: ["penpot", "penpot-mcp"],
        },
      },
      {
        filePathPattern: /(^|[/\\])penpot(?:[/\\]|[-_])/iu,
        signals: {
          concerns: [
            "design-source",
            "design-mcp",
            "frontend-design",
            "penpot",
            "penpot-mrds",
          ],
          tooling: ["penpot", "penpot-mcp"],
        },
      },
    ],
  },
  {
    id: "finance-trading",
    extensions: [".pine", ".mq4", ".mq5"],
    filePathPattern:
      /(^|[/\\])(trading|quant|market-data|backtests?|forex|stocks?|finance[-_]?trading|finance[-_]?data)([/\\]|$)/iu,
    signals: {
      concerns: [
        "trading",
        "market-analysis",
        "quant-finance",
        "financial-data",
        "backtesting",
      ],
    },
  },
  {
    id: "bi-dashboarding",
    extensions: [".pbix", ".pbit", ".pbip", ".twb", ".twbx", ".hyper", ".lkml"],
    filePathPattern:
      /(^|[/\\])(dashboards?|bi|business-intelligence|powerbi|tableau|looker)([/\\]|$)/iu,
    signals: {
      concerns: [
        "business-intelligence",
        "dashboarding",
        "reporting",
        "analytics",
      ],
    },
    conditionalSignals: [
      {
        fileNamePattern: /\.(?:pbix|pbit|pbip)$/iu,
        signals: { tooling: ["power-bi"] },
      },
      {
        fileNamePattern: /\.(?:twb|twbx|hyper)$/iu,
        signals: { tooling: ["tableau"] },
      },
      {
        fileNamePattern: /\.lkml$/iu,
        signals: { tooling: ["looker"] },
      },
    ],
  },
  {
    id: "devops-platform",
    fileNames: [
      ".gitlab-ci.yml",
      ".gitlab-ci.yaml",
      "Jenkinsfile",
      "azure-pipelines.yml",
      "azure-pipelines.yaml",
      "cloudbuild.yaml",
      "Chart.yaml",
      "kustomization.yaml",
      "skaffold.yaml",
      "ansible.cfg",
      "Pulumi.yaml",
      "Taskfile.yml",
      "Taskfile.yaml",
    ],
    filePathPattern:
      /(^|[/\\])(?:\.github[/\\]workflows|devops|platform-engineering|k8s|kubernetes|helm|charts|ansible|terraform|pulumi)([/\\]|$)/iu,
    signals: {
      concerns: ["devops", "ci-cd", "infrastructure", "platform-engineering"],
    },
    conditionalSignals: [
      {
        fileNamePattern: /^Chart\.yaml$/iu,
        filePathPattern: /(^|[/\\])(helm|charts)([/\\]|$)/iu,
        signals: { tooling: ["helm", "kubernetes"] },
      },
      {
        fileNamePattern: /^(kustomization|skaffold)\.ya?ml$/iu,
        filePathPattern: /(^|[/\\])(k8s|kubernetes)([/\\]|$)/iu,
        signals: { tooling: ["kubernetes"] },
      },
      {
        filePathPattern: /(^|[/\\])ansible([/\\]|$)/iu,
        signals: { tooling: ["ansible"] },
      },
      {
        filePathPattern: /(^|[/\\])pulumi([/\\]|$)/iu,
        signals: { tooling: ["pulumi"] },
      },
    ],
  },
  {
    id: "monorepo-build",
    fileNames: [
      "nx.json",
      "turbo.json",
      "pnpm-workspace.yaml",
      "rush.json",
      "lage.config.js",
      "WORKSPACE",
      "WORKSPACE.bazel",
      "MODULE.bazel",
    ],
    filePathPattern:
      /(^|[/\\])(?:apps|packages|workspaces|monorepo|bazel)([/\\]|$)/iu,
    signals: {
      concerns: ["monorepo", "build-orchestration"],
    },
    conditionalSignals: [
      {
        fileNamePattern: /^nx\.json$/iu,
        signals: { tooling: ["nx"] },
      },
      {
        fileNamePattern: /^turbo\.json$/iu,
        signals: { tooling: ["turborepo"] },
      },
      {
        fileNamePattern: /^pnpm-workspace\.yaml$/iu,
        signals: { packageManagers: ["pnpm"], tooling: ["pnpm-workspace"] },
      },
      {
        fileNamePattern: /^(?:WORKSPACE|WORKSPACE\.bazel|MODULE\.bazel)$/iu,
        signals: { tooling: ["bazel"] },
      },
    ],
  },
  {
    id: "serverless-edge",
    fileNames: [
      "wrangler.toml",
      "vercel.json",
      "netlify.toml",
      "serverless.yml",
      "serverless.yaml",
      "sst.config.ts",
      "sst.config.js",
      "firebase.json",
      "samconfig.toml",
    ],
    filePathPattern:
      /(^|[/\\])(?:functions|lambda|edge|workers|cloudflare|netlify|vercel)([/\\]|$)/iu,
    signals: {
      concerns: ["serverless", "edge", "cloud", "infrastructure"],
    },
    conditionalSignals: [
      {
        fileNamePattern: /^wrangler\.toml$/iu,
        signals: { tooling: ["cloudflare"] },
      },
      {
        fileNamePattern: /^vercel\.json$/iu,
        signals: { tooling: ["vercel"] },
      },
      {
        fileNamePattern: /^netlify\.toml$/iu,
        signals: { tooling: ["netlify"] },
      },
      {
        fileNamePattern: /^serverless\.ya?ml$/iu,
        signals: { tooling: ["lambda"] },
      },
    ],
  },
  {
    id: "commerce-cms-platform",
    fileNames: [
      "shopify.app.toml",
      "shopify.theme.toml",
      "strapi.config.js",
      "payload.config.ts",
      "directus.config.ts",
    ],
    filePathPattern:
      /(^|[/\\])(?:shopify|commerce|ecommerce|magento|woocommerce|strapi|payload|directus|contentful)([/\\]|$)/iu,
    signals: {
      concerns: ["commerce", "cms", "content-creation"],
    },
    conditionalSignals: [
      {
        filePathPattern: /(^|[/\\])shopify([/\\]|$)/iu,
        signals: { tooling: ["shopify"] },
      },
    ],
  },
  {
    id: "security-rules",
    extensions: [".sarif", ".yara", ".yar", ".rego"],
    fileNames: [
      ".semgrep.yml",
      ".semgrep.yaml",
      ".snyk",
      "gitleaks.toml",
      "trivy.yaml",
      "trivy.yml",
      "grype.yaml",
      "grype.yml",
      "bandit.yaml",
      "bandit.yml",
      "codeql-config.yml",
      "codeql-config.yaml",
    ],
    filePathPattern:
      /(^|[/\\])(sast|threat-model|detections|osint|malware|reverse-engineering)([/\\]|$)/iu,
    signals: {
      concerns: [
        "security",
        "sast",
        "policy-as-code",
        "vulnerability-management",
      ],
    },
    conditionalSignals: [
      {
        fileNamePattern: /\.(?:yara|yar)$/iu,
        signals: { concerns: ["malware-analysis", "reverse-engineering"] },
      },
      {
        fileNamePattern: /gitleaks|trivy|grype|snyk/iu,
        signals: { concerns: ["secret-scanning", "container-security"] },
      },
    ],
  },
  {
    id: "network-automation",
    extensions: [".gns3", ".pkt", ".ovpn"],
    fileNames: [
      "named.conf",
      "Corefile",
      "dnsmasq.conf",
      "nginx.conf",
      "haproxy.cfg",
      "envoy.yaml",
      "nftables.conf",
      "bird.conf",
      "wg0.conf",
    ],
    filePathPattern:
      /(^|[/\\])(netops|dns|vpn|wireguard|routing|firewall)([/\\]|$)/iu,
    signals: {
      concerns: ["networking", "netops", "network-automation"],
    },
  },
  {
    id: "mlops-model-artifacts",
    extensions: [
      ".gguf",
      ".ggml",
      ".tflite",
      ".ckpt",
      ".keras",
      ".mlmodel",
      ".mar",
    ],
    fileNames: ["dvc.yaml", "MLproject", "model-card.md"],
    filePathPattern:
      /(^|[/\\])(checkpoints?|mlruns|evals?|rag|vectors?)([/\\]|$)/iu,
    signals: {
      concerns: ["ai", "machine-learning", "model-artifacts"],
    },
    conditionalSignals: [
      {
        fileNamePattern: /^(dvc\.yaml|MLproject)$/iu,
        signals: { concerns: ["mlops", "model-training"] },
      },
      {
        filePathPattern: /(^|[/\\])(rag|vectors?)([/\\]|$)/iu,
        signals: { concerns: ["rag", "vector-search"] },
      },
    ],
  },
  {
    id: "audio-production",
    extensions: [
      ".rpp",
      ".sesx",
      ".musicxml",
      ".mxl",
      ".sib",
      ".ogg",
      ".opus",
      ".aiff",
      ".aac",
    ],
    filePathPattern: /(^|[/\\])(audio|music|sound)([/\\]|$)/iu,
    signals: {
      concerns: ["media", "audio-production", "music", "creative-production"],
    },
  },
  {
    id: "video-vfx",
    extensions: [
      ".mkv",
      ".webm",
      ".avi",
      ".m4v",
      ".exr",
      ".dpx",
      ".hdr",
      ".kra",
      ".clip",
      ".procreate",
    ],
    filePathPattern:
      /(^|[/\\])(video|vfx|renders?|generative-art|motion-graphics)([/\\]|$)/iu,
    signals: {
      concerns: ["media", "video-production", "vfx", "image-processing"],
    },
  },
  {
    id: "embedded-systems",
    extensions: [
      ".ino",
      ".dts",
      ".dtsi",
      ".ld",
      ".asm",
      ".hex",
      ".elf",
      ".uf2",
      ".svd",
      ".overlay",
    ],
    fileNames: [
      "platformio.ini",
      "arduino-cli.yaml",
      "sdkconfig",
      "Kconfig",
      "defconfig",
    ],
    filePathPattern:
      /(^|[/\\])(firmware|embedded|rtos|drivers|kernel|boards|zephyr|esp-idf)([/\\]|$)/iu,
    signals: {
      concerns: [
        "embedded",
        "firmware",
        "rtos",
        "systems-programming",
        "hardware",
      ],
    },
  },
  {
    id: "robotics-simulation",
    extensions: [".sdf", ".srdf", ".world", ".bag"],
    filePathPattern:
      /(^|[/\\])(gazebo|ignition|webots|isaac|moveit|nav2|slam|px4|ardupilot|mavlink|drones)([/\\]|$)|\.launch\.py$/iu,
    signals: {
      concerns: ["robotics", "simulation"],
    },
    conditionalSignals: [
      {
        filePathPattern: /(^|[/\\])(nav2|slam|moveit)([/\\]|$)/iu,
        signals: { concerns: ["slam", "motion-planning", "autonomy"] },
      },
      {
        filePathPattern: /(^|[/\\])(px4|ardupilot|mavlink|drones)([/\\]|$)/iu,
        signals: { concerns: ["drones", "autonomy"] },
      },
    ],
  },
  {
    id: "blockchain-extended",
    extensions: [".move", ".cairo", ".clar", ".teal"],
    fileNames: [
      "Anchor.toml",
      "truffle-config.js",
      "brownie-config.yaml",
      "ape-config.yaml",
      "remappings.txt",
    ],
    filePathPattern:
      /(^|[/\\])(smart-contracts|defi|solana|cairo|substrate|cosmwasm)([/\\]|$)/iu,
    signals: {
      concerns: ["blockchain", "cryptography", "smart-contracts", "defi"],
    },
  },
  {
    id: "data-mining-engineering",
    extensions: [
      ".db",
      ".feather",
      ".hdf5",
      ".hdf",
      ".zarr",
      ".ndjson",
      ".dbml",
    ],
    fileNames: [
      "dbt_project.yml",
      "profiles.yml",
      "schema.yml",
      "dvc.yaml",
      "dvc.lock",
      "great_expectations.yml",
      "airflow.cfg",
      ".sqlfluff",
    ],
    filePathPattern:
      /(^|[/\\])(etl|elt|lakehouse|marts|pipelines|dags|scrapers|data-mining)([/\\]|$)/iu,
    signals: {
      concerns: [
        "data",
        "data-engineering",
        "data-mining",
        "etl",
        "analytics-engineering",
      ],
    },
  },
  {
    id: "slicer-printing",
    extensions: [
      ".amf",
      ".bgcode",
      ".ctb",
      ".photon",
      ".sl1",
      ".curaprofile",
      ".lys",
      ".chitubox",
    ],
    fileNames: [
      "printer.cfg",
      "moonraker.conf",
      "PrusaSlicer.ini",
      "SuperSlicer.ini",
    ],
    filePathPattern:
      /(^|[/\\])(slicer|prints|klipper|moonraker|cnc|additive-manufacturing)([/\\]|$)/iu,
    signals: {
      concerns: [
        "3d-printing",
        "fabrication",
        "hardware",
        "slicer",
        "additive-manufacturing",
      ],
    },
  },
  {
    id: "marketing-content",
    fileNames: [
      "robots.txt",
      "sitemap.xml",
      "next-sitemap.config.js",
      "contentlayer.config.ts",
      "sanity.config.ts",
    ],
    filePathPattern:
      /(^|[/\\])(marketing|seo|content|ads|advertising|lead-gen|leads|blog|campaigns|landing-pages|editorial|cms|content-marketing)([/\\]|$)/iu,
    signals: {
      concerns: ["seo"],
    },
    conditionalSignals: [
      {
        filePathPattern:
          /(^|[/\\])(marketing|ads|advertising|lead-gen|leads|campaigns|landing-pages)([/\\]|$)/iu,
        signals: {
          concerns: [
            "marketing",
            "content-creation",
            "lead-generation",
            "campaigns",
          ],
        },
      },
      {
        filePathPattern:
          /(^|[/\\])(content|editorial|content-marketing)([/\\]|$)/iu,
        signals: { concerns: ["content-creation", "content-marketing"] },
      },
      {
        filePathPattern: /(^|[/\\])cms([/\\]|$)/iu,
        signals: { concerns: ["cms"] },
      },
      {
        filePathPattern: /(^|[/\\])blog([/\\]|$)/iu,
        signals: {
          concerns: ["blog", "content-creation", "content-marketing"],
        },
      },
    ],
  },
];
