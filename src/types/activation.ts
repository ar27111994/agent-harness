import type { HostTarget, SessionIntent } from "./core.js";

/**
 * Describes reversible host-native config operations recorded in wire plans.
 */
export interface NativeConfigOperation {
  path: string;
  format: "text" | "json";
  mode: "write" | "merge";
  content?: string | Record<string, unknown>;
  previousContent?: Record<string, unknown> | null;
}

/**
 * Describes exact pre-apply snapshots for managed text files that must round-trip cleanly on reset.
 */
export interface ManagedTextFileSnapshot {
  path: string;
  content: string | null;
}

/**
 * Describes activation manifest data exchanged by the lifecycle pipeline.
 */
export interface ActivationManifest {
  schemaVersion: number;
  host: HostTarget;
  generatedAt: string;
  generationId?: string;
  activeBundles: string[];
  activeAssets: string[];
  runtimeRoot: string;
  notes: string[];
}

/**
 * Describes copilot workspace overlay manifest data exchanged by the lifecycle pipeline.
 */
export interface CopilotWorkspaceOverlayManifest {
  schemaVersion: 1;
  host: "copilot-vscode";
  generatedAt: string;
  workspaceRoot: string;
  selectedBundleIds: string[];
  selectedAssetIds: string[];
  activationBudget: number;
  mode: string;
  sessionIntent?: SessionIntent;
  concernBuckets?: Record<string, string[]>;
  taskModeBuckets?: Record<string, string[]>;
}

/**
 * Describes copilot workspace profile manifest data exchanged by the lifecycle pipeline.
 */
export interface CopilotWorkspaceProfileManifest {
  schemaVersion: number;
  generatedAt: string;
  profileId: string;
  workspaceRoot: string;
  bundleIds: string[];
  selectedAssetIds: string[];
  selectedInstructionIds: string[];
  selectedAgentIds: string[];
  selectedWorkflowIds: string[];
  selectedPluginIds?: string[];
  selectedExtensionIds?: string[];
  selectedHookIds?: string[];
  selectedSkillIds?: string[];
  activationBudget: number;
  sessionIntent?: SessionIntent;
}

/**
 * Describes wire plan manifest data exchanged by the lifecycle pipeline.
 */
export interface WirePlanManifest {
  schemaVersion: number;
  host:
    | HostTarget
    | "vscode-user"
    | "opencode-project"
    | "cursor"
    | "zed"
    | "claude-code"
    | "pi";
  generatedAt: string;
  workspaceRoot: string;
  runtimeRoot: string;
  linkedPaths?: string[];
  instructionsFiles?: string[];
  agentFiles?: string[];
  skillDirs?: string[];
  pluginDirs?: string[];
  workflowFiles?: string[];
  referenceFiles?: string[];
  extensionIds?: string[];
  mcpServers?: string[];
  nativeInstallActions?: string[];
  hookFiles?: string[];
  nativeConfigOperations?: NativeConfigOperation[];
  textFileSnapshots?: ManagedTextFileSnapshot[];
  notes: string[];
}

/**
 * Describes wire preview manifest data exchanged by the lifecycle pipeline.
 */
export interface WirePreviewManifest {
  schemaVersion: number;
  host: "vscode" | "opencode";
  mode: "preview" | "apply" | "reset";
  generatedAt: string;
  workspaceRoot: string;
  targetPaths: string[];
  notes: string[];
}
