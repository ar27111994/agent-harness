import type { DemandProfile } from "../../types.js";

/**
 * Captured demand profile distilled from a real, meaningfully coded Flutter/iOS workspace audit.
 */
export const interactnoteFullDemandProfile: DemandProfile = {
  schemaVersion: 1,
  generatedAt: "2026-05-10T14:00:29.850Z",
  scanRoot: "fixtures/interactnote-full",
  summary: {
    scannedFiles: 411,
    matchedFiles: 353,
    scanTruncated: false,
    scannedBytes: 49_864_604,
  },
  signals: {
    languages: ["c", "cpp", "dart", "swift"],
    packageManagers: ["pub"],
    frameworks: ["flutter"],
    concerns: [
      "creative-production",
      "debugging",
      "design-assets",
      "design-systems",
      "documentation",
      "frontend",
      "ios",
      "knowledge-base",
      "logging",
      "media",
      "mobile",
      "research",
      "security",
      "writing",
    ],
    tooling: [
      "asset-pipeline",
      "cmake",
      "detector:design-system",
      "detector:documentation",
      "detector:media-design",
      "detector:mobile",
      "flutter",
      "ios",
      "pub",
      "pub:cupertino_icons",
      "pub:flutter",
      "pub:flutter_lints",
      "pub:flutter_test",
      "xcode",
    ],
  },
  evidence: [
    {
      path: "pubspec.yaml",
      fileName: "pubspec.yaml",
      evidenceStrength: "strong",
      matchedSignals: {
        languages: ["dart"],
        packageManagers: ["pub"],
        frameworks: ["flutter"],
        concerns: ["frontend", "ios", "mobile"],
        tooling: ["flutter", "pub", "pub:flutter", "pub:flutter_test"],
      },
    },
    {
      path: "ios/Runner.xcodeproj/project.pbxproj",
      fileName: "project.pbxproj",
      evidenceStrength: "strong",
      matchedSignals: {
        languages: ["swift", "c", "cpp"],
        packageManagers: [],
        frameworks: [],
        concerns: ["ios", "mobile"],
        tooling: ["ios", "xcode"],
      },
    },
    {
      path: "design/inspiration/developer_handoff_guide.html",
      fileName: "developer_handoff_guide.html",
      evidenceStrength: "medium",
      matchedSignals: {
        languages: [],
        packageManagers: [],
        frameworks: [],
        concerns: ["design-assets", "design-systems", "frontend", "research"],
        tooling: ["detector:design-system", "detector:media-design"],
      },
    },
  ],
};
