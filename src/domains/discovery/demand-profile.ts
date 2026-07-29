import { basename } from "node:path";
import { stat } from "node:fs/promises";

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
  options: { maxBytes?: number } = {},
): Promise<DemandProfile> {
  const budgetOptions = options.maxBytes ? { maxBytes: options.maxBytes } : {};
  const scanResult = await listFilesRecursiveWithTelemetry(
    scanRoot,
    undefined,
    budgetOptions,
  );
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

  const profile: DemandProfile = {
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

  if (scanResult.telemetry.truncated) {
    // truncationReason is always set when truncated via listFilesRecursiveWithTelemetry;
    // the "budget-exceeded" fallback guards against future changes to the telemetry API.
    /* c8 ignore next */
    const reason = scanResult.telemetry.truncationReason ?? "budget-exceeded";
    const mb = (scanResult.telemetry.visitedBytes / 1_048_576).toFixed(1);

    // Compute top directories by byte count for actionable guidance
    const dirCounts = await computeDirectoryByteCounts(scanRoot, scannedFiles);
    const topDirs = dirCounts.slice(0, 5);

    let dirGuidance = "";
    if (topDirs.length > 0) {
      const dirLines = topDirs.map(
        (d) => `    ${d.path} (${(d.bytes / 1_048_576).toFixed(1)} MB)`,
      );
      dirGuidance = `\n  Top directories by scan bytes:\n${dirLines.join("\n")}\n`;
    }

    const ignorePath = `${toPosixPath(scanRoot)}/.agent-harnessignore`;
    const missedSignalNote =
      evidence.length > 0
        ? `\n  Note: ${evidence.length} demand signals were recorded before truncation; additional signals may have been missed.`
        : "";

    process.stderr.write(
      `[warn] Demand-signal scan truncated (reason: ${reason}, scanned ${scannedFiles.length} files / ${mb} MB). ` +
        `Demand profile may be incomplete.${missedSignalNote}\n` +
        `${dirGuidance}` +
        `  To fix:\n` +
        `    • Create ${ignorePath} and add patterns for large directories\n` +
        `    • Or increase the limit via --max-scan-bytes (or AGENT_HARNESS_SCAN_MAX_BYTES env var, currently ${mb} MB visited)\n` +
        `    • Run 'discover full' again after excluding unnecessary directories\n`,
    );
  }

  return profile;
}

/**
 * Computes the top directories by byte count from a list of scanned file
 * paths. Stats each file to measure actual bytes consumed per top-level
 * directory. Files that cannot be statted (deleted mid-scan) are skipped.
 * Used to generate actionable truncation-warning guidance.
 */
async function computeDirectoryByteCounts(
  scanRoot: string,
  files: string[],
): Promise<Array<{ path: string; bytes: number }>> {
  const dirBytes = new Map<string, number>();

  for (const filePath of files) {
    const relative = toRelativePosixPath(scanRoot, filePath);
    const dir = relative.split("/")[0] ?? ".";
    let size = 0;
    try {
      const s = await stat(filePath);
      size = s.size;
    } catch {
      // File may have been deleted between scan and stat — skip
    }
    dirBytes.set(dir, (dirBytes.get(dir) ?? 0) + size);
  }

  return [...dirBytes.entries()]
    .map(([path, bytes]) => ({ path, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}
