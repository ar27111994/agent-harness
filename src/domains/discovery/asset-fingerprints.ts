import { createHash } from "node:crypto";
import { join } from "node:path";

import { readJsonLinesFile, toPosixPath, writeJsonFile } from "../../files.js";
import { assertAssetCatalogEntry } from "../../manifest-validation.js";
import { MIRROR_INDEX_OUTPUT_PATH } from "../../mirror/constants.js";
import type {
  AssetCatalogEntry,
  HostTarget,
  MirrorIndexEntry,
} from "../../types.js";
import {
  ASSET_FINGERPRINTS_OUTPUT_PATH,
  CATALOG_OUTPUT_PATH,
} from "./output-paths.js";

/**
 * Describes stable lifecycle identity for one catalog or mirror asset.
 */
export interface AssetLifecycleFingerprint {
  assetId: string;
  lifecycleFingerprint: string;
  canonicalUpstreamIdentity: string;
  sourceCatalogIdentity: string;
  contentHash?: string;
  version?: string;
  ref?: string;
  commit?: string;
  acquiredAt?: string;
  catalogedAt?: string;
  trustTier: string;
  quarantineState?: MirrorIndexEntry["status"];
  hosts: HostTarget[];
  duplicateGroup?: string;
}

/**
 * Describes the asset lifecycle fingerprint report.
 */
export interface AssetLifecycleFingerprintReport {
  schemaVersion: number;
  generatedAt: string;
  assetCount: number;
  duplicateGroupCount: number;
  fingerprints: AssetLifecycleFingerprint[];
  duplicateGroups: Array<{
    groupId: string;
    assetIds: string[];
    fingerprints: string[];
    evidence: Array<{
      assetId: string;
      sourceCatalogIdentity: string;
      canonicalUpstreamIdentity: string;
      contentHash?: string;
    }>;
  }>;
}

/**
 * Writes asset lifecycle fingerprints derived from current catalog and mirror state.
 */
export async function writeAssetLifecycleFingerprintReport(
  projectRoot: string,
): Promise<AssetLifecycleFingerprintReport> {
  const report = await buildAssetLifecycleFingerprintReport(projectRoot);
  await writeJsonFile(
    join(projectRoot, ...ASSET_FINGERPRINTS_OUTPUT_PATH),
    report,
  );
  return report;
}

/**
 * Builds asset lifecycle fingerprints derived from current catalog and mirror state.
 */
export async function buildAssetLifecycleFingerprintReport(
  projectRoot: string,
): Promise<AssetLifecycleFingerprintReport> {
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
    assertAssetCatalogEntry,
  );
  const mirrorEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
  );
  const mirrorByAssetId = new Map(
    mirrorEntries.map((entry) => [entry.assetId, entry] as const),
  );
  const fingerprints = catalogEntries
    .map((entry) =>
      buildAssetLifecycleFingerprint(entry, mirrorByAssetId.get(entry.id)),
    )
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const duplicateGroups = buildDuplicateGroups(fingerprints);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    assetCount: fingerprints.length,
    duplicateGroupCount: duplicateGroups.length,
    fingerprints,
    duplicateGroups,
  };
}

/**
 * Builds stable lifecycle identity for one asset.
 */
export function buildAssetLifecycleFingerprint(
  entry: AssetCatalogEntry,
  mirrorEntry?: MirrorIndexEntry,
): AssetLifecycleFingerprint {
  const canonicalUpstreamIdentity = buildCanonicalUpstreamIdentity(
    entry,
    mirrorEntry,
  );
  const sourceCatalogIdentity = [
    entry.source.sourceId,
    entry.id,
    entry.assetKind,
    entry.compatibilityMode,
  ].join("|");
  const contentHash = mirrorEntry?.contentHash;
  const lifecycleFingerprint = hashStableJson({
    canonicalUpstreamIdentity,
    sourceCatalogIdentity,
    contentHash,
    hosts: [...entry.hosts].sort(),
    trustTier: mirrorEntry?.source.authorityTier ?? entry.source.authorityTier,
    quarantineState: mirrorEntry?.status,
  });

  return {
    assetId: entry.id,
    lifecycleFingerprint,
    canonicalUpstreamIdentity,
    sourceCatalogIdentity,
    contentHash,
    version: mirrorEntry?.upstream.version,
    ref: mirrorEntry?.upstream.ref,
    commit: mirrorEntry?.upstream.commit,
    acquiredAt: mirrorEntry?.mirroredAt,
    catalogedAt: entry.maintenance.lastUpdated,
    trustTier: mirrorEntry?.source.authorityTier ?? entry.source.authorityTier,
    quarantineState: mirrorEntry?.status,
    hosts: [...entry.hosts].sort(),
    duplicateGroup: entry.dedupe.duplicateGroup,
  };
}

function buildCanonicalUpstreamIdentity(
  entry: AssetCatalogEntry,
  mirrorEntry?: MirrorIndexEntry,
): string {
  if (mirrorEntry) {
    return [
      mirrorEntry.upstream.type,
      normalizeIdentityUrl(mirrorEntry.upstream.url),
      mirrorEntry.upstream.version ??
        mirrorEntry.upstream.commit ??
        mirrorEntry.upstream.ref ??
        "unversioned",
    ].join("|");
  }

  return [
    entry.source.sourceKind,
    normalizeIdentityUrl(entry.source.originUrl),
    entry.install.relativePath ?? entry.evidence.filePath ?? entry.id,
  ].join("|");
}

function normalizeIdentityUrl(value: string): string {
  return toPosixPath(value)
    .replace(/\.git$/iu, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

function hashStableJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildDuplicateGroups(
  fingerprints: AssetLifecycleFingerprint[],
): AssetLifecycleFingerprintReport["duplicateGroups"] {
  const byGroup = new Map<string, AssetLifecycleFingerprint[]>();

  for (const fingerprint of fingerprints) {
    const groupId = fingerprint.duplicateGroup;
    if (!groupId) {
      continue;
    }
    const group = byGroup.get(groupId) ?? [];
    group.push(fingerprint);
    byGroup.set(groupId, group);
  }

  return [...byGroup.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([groupId, group]) => ({
      groupId,
      assetIds: group.map((fingerprint) => fingerprint.assetId).sort(),
      fingerprints: group
        .map((fingerprint) => fingerprint.lifecycleFingerprint)
        .sort(),
      evidence: group
        .map((fingerprint) => ({
          assetId: fingerprint.assetId,
          sourceCatalogIdentity: fingerprint.sourceCatalogIdentity,
          canonicalUpstreamIdentity: fingerprint.canonicalUpstreamIdentity,
          contentHash: fingerprint.contentHash,
        }))
        .sort((left, right) => left.assetId.localeCompare(right.assetId)),
    }))
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
}
