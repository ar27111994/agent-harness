import { basename } from "node:path";

import {
  listFilesRecursiveWithTelemetry,
  toPosixPath,
  toRelativePosixPath,
} from "../../files.js";
import type { DemandEvidence, DemandProfile } from "../../types.js";
import {
  collectDemandSignalsForFile,
  getDemandEvidenceStrength,
  shouldInspectFile,
} from "./demand-signals.js";
import {
  createEmptySignalSet,
  hasAnySignals,
  mergeSignals,
  sortSignalSet,
} from "./signals.js";

/**
 * Builds demand profile from the provided inputs.
 */
export async function buildDemandProfile(
  scanRoot: string,
): Promise<DemandProfile> {
  const scanResult = await listFilesRecursiveWithTelemetry(scanRoot);
  const scannedFiles = scanResult.files;
  const evidence: DemandEvidence[] = [];
  const aggregateSignals = createEmptySignalSet();

  for (const filePath of scannedFiles) {
    const fileName = basename(filePath);

    const evidenceStrength = getDemandEvidenceStrength(fileName, filePath);
    if (evidenceStrength === null || !shouldInspectFile(fileName, filePath)) {
      continue;
    }

    const matchedSignals = await collectDemandSignalsForFile(
      fileName,
      filePath,
    );

    if (!hasAnySignals(matchedSignals)) {
      continue;
    }

    mergeSignals(aggregateSignals, matchedSignals);
    evidence.push({
      path: toRelativePosixPath(scanRoot, filePath),
      fileName,
      evidenceStrength,
      matchedSignals,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: toPosixPath(scanRoot),
    summary: {
      scannedFiles: scannedFiles.length,
      matchedFiles: evidence.length,
      scanTruncated: scanResult.telemetry.truncated,
      truncationReason: scanResult.telemetry.truncationReason,
      scannedBytes: scanResult.telemetry.visitedBytes,
    },
    signals: sortSignalSet(aggregateSignals),
    evidence: evidence.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}
