import { extname } from "node:path";

import type { DemandSignalSet } from "../../types.js";
import {
  DETECTOR_SIGNATURES,
  type DetectorSignalSet,
  type DetectorSignature,
} from "./detector-signatures.js";
import { addSignals } from "./signals.js";

export interface FileDetector {
  id: string;
  matches(fileName: string, filePath: string): boolean;
  applySignals(
    target: DemandSignalSet,
    fileName: string,
    filePath: string,
  ): void;
}

export const FILE_DETECTORS: FileDetector[] = DETECTOR_SIGNATURES.map(
  createSignatureDetector,
);

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

function createSignatureDetector(signature: DetectorSignature): FileDetector {
  const normalizedExtensions = new Set(
    (signature.extensions ?? []).map((extension) => extension.toLowerCase()),
  );
  const normalizedFileNames = new Set(signature.fileNames ?? []);

  return {
    id: signature.id,
    matches: (fileName, filePath) =>
      normalizedExtensions.has(extname(fileName).toLowerCase()) ||
      normalizedFileNames.has(fileName) ||
      Boolean(signature.filePathPattern?.test(filePath)),
    applySignals: (target, fileName, filePath) => {
      applySignalSet(target, signature.signals);
      for (const conditionalSignals of signature.conditionalSignals ?? []) {
        const matchesFileName =
          conditionalSignals.fileNamePattern?.test(fileName) ?? false;
        const matchesFilePath =
          conditionalSignals.filePathPattern?.test(filePath) ?? false;
        if (matchesFileName || matchesFilePath) {
          applySignalSet(target, conditionalSignals.signals);
        }
      }
    },
  };
}

function applySignalSet(
  target: DemandSignalSet,
  signals: DetectorSignalSet,
): void {
  addSignals(target.languages, signals.languages ?? []);
  addSignals(target.packageManagers, signals.packageManagers ?? []);
  addSignals(target.frameworks, signals.frameworks ?? []);
  addSignals(target.concerns, signals.concerns ?? []);
  addSignals(target.tooling, signals.tooling ?? []);
}
