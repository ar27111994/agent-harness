import { join } from "node:path";

import { readJsonFileOrNull } from "../files.js";
import { assertActivationManifest } from "../manifest-validation.js";
import type { ActivationManifest } from "../types.js";

export async function readSharedMcpAssetIds(
  projectRoot: string,
): Promise<string[]> {
  const sharedActivationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    assertActivationManifest,
  );

  return [...new Set(sharedActivationManifest?.activeAssets ?? [])].sort(
    (left, right) => left.localeCompare(right),
  );
}
