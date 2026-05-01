import { join } from "node:path";

import {
  ensureDirectory,
  removePath,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import type { WirePlanManifest, WirePreviewManifest } from "../types.js";
import type { WireMode } from "./registry.js";

export async function writeHostGuidanceWirePlan(
  host: "cursor" | "zed",
  options: {
    projectRoot: string;
    workspaceRoot: string;
    mode: WireMode;
  },
): Promise<void> {
  const activationRoot = join(options.projectRoot, "activate", host);

  if (options.mode === "reset") {
    await removePath(activationRoot);
    return;
  }

  await ensureDirectory(activationRoot);

  const preview: WirePreviewManifest = {
    schemaVersion: 1,
    host: host === "cursor" ? "vscode" : "opencode",
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(options.workspaceRoot),
    targetPaths: [toPosixPath(activationRoot)],
    notes: [
      `${host} is registered through the host adapter model.`,
      "This adapter currently emits an explicit guidance plan instead of mutating host-native settings.",
      "Use setup doctor for runtime prerequisites and host-specific onboarding guidance.",
    ],
  };

  const wirePlan: WirePlanManifest = {
    schemaVersion: 1,
    host,
    generatedAt: preview.generatedAt,
    workspaceRoot: preview.workspaceRoot,
    runtimeRoot: toPosixPath(activationRoot),
    nativeInstallActions: [
      `Review ${host} native configuration and import staged assets from the lifecycle host runtime view.`,
    ],
    notes: preview.notes,
  };

  await writeJsonFile(
    join(activationRoot, `wire-preview-${host}.json`),
    preview,
  );

  if (options.mode === "preview") {
    return;
  }

  await writeJsonFile(join(activationRoot, "wire-plan.json"), wirePlan);
}
