import { join } from "node:path";

import {
  ensureDirectory,
  removePath,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import type { WirePlanManifest, WirePreviewManifest } from "../types.js";
import type { WireMode } from "./registry.js";

export type GuidanceHost = "cursor" | "zed" | "claude-code" | "pi";

interface GuidanceHostMetadata {
  lifecycleHost: "vscode" | "opencode";
  displayName: string;
  nativeInstallActions: string[];
  notes: string[];
}

const GUIDANCE_HOSTS: Record<GuidanceHost, GuidanceHostMetadata> = {
  cursor: {
    lifecycleHost: "vscode",
    displayName: "Cursor",
    nativeInstallActions: [
      "Review Cursor's VS Code-compatible settings and import staged assets from the Copilot lifecycle runtime view.",
    ],
    notes: [
      "Cursor is registered through the host adapter model.",
      "This adapter currently emits an explicit guidance plan instead of mutating host-native settings.",
      "Use the Copilot-compatible lifecycle runtime view as the source for Cursor instructions, agents, skills, hooks, plugins, extensions, and shared MCP references.",
    ],
  },
  zed: {
    lifecycleHost: "opencode",
    displayName: "Zed",
    nativeInstallActions: [
      "Review Zed native assistant configuration and import staged assets from the OpenCode lifecycle runtime view.",
    ],
    notes: [
      "Zed is registered through the host adapter model.",
      "This adapter currently emits an explicit guidance plan instead of mutating host-native settings.",
      "Use the OpenCode-compatible lifecycle runtime view as the source for Zed instructions, agents, skills, workflows, hooks, plugins, reference packs, and shared MCP references.",
    ],
  },
  "claude-code": {
    lifecycleHost: "opencode",
    displayName: "Claude Code",
    nativeInstallActions: [
      "Review Claude Code project and user configuration, then import staged assets from the OpenCode lifecycle runtime view.",
      "Map project instructions into CLAUDE.md-compatible locations and map staged agents, skills, hooks, slash-command workflows, and MCP references according to your Claude Code setup.",
    ],
    notes: [
      "Claude Code is registered through the host adapter model.",
      "This adapter currently emits an explicit guidance plan instead of mutating host-native settings.",
      "Use the OpenCode-compatible lifecycle runtime view as the source for Claude Code instructions, agents, skills, workflows, hooks, plugins, reference packs, and shared MCP references.",
    ],
  },
  pi: {
    lifecycleHost: "opencode",
    displayName: "Pi",
    nativeInstallActions: [
      "Review Pi's AGENTS.md, SYSTEM.md, skills, prompt templates, and extension package conventions, then import staged assets from the OpenCode lifecycle runtime view.",
      "Treat shared MCP assets as references unless your Pi installation includes an MCP extension, because Pi does not ship with built-in MCP support.",
    ],
    notes: [
      "Pi is registered through the host adapter model.",
      "This adapter currently emits an explicit guidance plan instead of mutating host-native settings.",
      "Use the OpenCode-compatible lifecycle runtime view as the source for Pi AGENTS.md/SYSTEM.md guidance, skills, prompt templates, workflows, hooks, plugins, and reference packs.",
      "Pi can be extended with TypeScript modules and packages; use that extension boundary for behaviors that are not native Pi primitives.",
    ],
  },
};

export async function writeHostGuidanceWirePlan(
  host: GuidanceHost,
  options: {
    projectRoot: string;
    workspaceRoot: string;
    mode: WireMode;
  },
): Promise<void> {
  const activationRoot = join(options.projectRoot, "activate", host);
  const hostMetadata = GUIDANCE_HOSTS[host];

  if (options.mode === "reset") {
    await removePath(activationRoot);
    return;
  }

  await ensureDirectory(activationRoot);

  const preview: WirePreviewManifest = {
    schemaVersion: 1,
    host: hostMetadata.lifecycleHost,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(options.workspaceRoot),
    targetPaths: [toPosixPath(activationRoot)],
    notes: [
      ...hostMetadata.notes,
      "Use setup doctor for runtime prerequisites and host-specific onboarding guidance.",
    ],
  };

  const wirePlan: WirePlanManifest = {
    schemaVersion: 1,
    host,
    generatedAt: preview.generatedAt,
    workspaceRoot: preview.workspaceRoot,
    runtimeRoot: toPosixPath(activationRoot),
    nativeInstallActions: hostMetadata.nativeInstallActions,
    notes: [`${hostMetadata.displayName} guidance plan.`, ...preview.notes],
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
