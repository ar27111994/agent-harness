import { join } from "node:path";

import { readJsonFileOrNull, writeJsonFile } from "../../files.js";
import { REMOTE_HARVEST_STATE_OUTPUT_PATH } from "./output-paths.js";

export interface RemoteHarvestState {
  schemaVersion: number;
  generatedAt: string;
  nextRepoOffset: number;
  completedSourceIds: string[];
}

export async function loadRemoteHarvestState(
  projectRoot: string,
): Promise<RemoteHarvestState> {
  return (
    (await readJsonFileOrNull<RemoteHarvestState>(
      join(projectRoot, ...REMOTE_HARVEST_STATE_OUTPUT_PATH),
    )) ?? {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      nextRepoOffset: 0,
      completedSourceIds: [],
    }
  );
}

export async function writeRemoteHarvestState(
  projectRoot: string,
  state: RemoteHarvestState,
): Promise<void> {
  await writeJsonFile(
    join(projectRoot, ...REMOTE_HARVEST_STATE_OUTPUT_PATH),
    state,
  );
}
