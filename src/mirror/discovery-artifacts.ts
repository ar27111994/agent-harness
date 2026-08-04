import { join } from "node:path";

import { readJsonFileOrNull, readJsonLinesFile } from "../files.js";
import { assertAssetCatalogEntry } from "../manifest-validation.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SourceIndex,
} from "../types.js";

/**
 * Typed bundle of the discovery artifacts the mirror/install lifecycle reads
 * together (#437). Loading them through one helper keeps the per-artifact
 * path plumbing in a single place and preserves the original semantics:
 * required artifacts throw on read/validation failure, optional artifacts
 * (demand profile, source index) stay `null` when absent.
 */
export interface DiscoveryArtifacts {
  demandProfile: DemandProfile | null;
  sourceIndex: SourceIndex | null;
  catalogEntries: AssetCatalogEntry[];
  selectedEntries: AssetCatalogEntry[];
}

/**
 * Loads the discovery artifact family for a project root.
 *
 * Reads are intentionally sequential to preserve failure ordering: the first
 * artifact that fails (missing required file, invalid JSON, rejected schema)
 * fails the whole load with its original error, exactly as the previous
 * inline read sequence behaved.
 */
export async function loadDiscoveryArtifacts(
  projectRoot: string,
): Promise<DiscoveryArtifacts> {
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
  );
  const sourceIndex = await readJsonFileOrNull<SourceIndex>(
    join(projectRoot, "discover", "output", "source-index.json"),
  );
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "catalog.assets.jsonl"),
    assertAssetCatalogEntry,
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );

  return { demandProfile, sourceIndex, catalogEntries, selectedEntries };
}
