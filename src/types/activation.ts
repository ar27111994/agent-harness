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
  recommendationHost?: HostTarget;
  activationBudget?: number;
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
  host: HostTarget;
  generatedAt: string;
  workspaceRoot: string;
  selectedBundleIds: string[];
  selectedAssetIds: string[];
  activationBudget: number;
  mode: string;
  recommendationHost?: HostTarget;
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
    | "pi"
    | "codex";
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
  /**
   * Documents the npm install step that OpenCode runs inside its overlay
   * directory (.opencode/) to load plugins. This is performed by OpenCode
   * itself (not by wire --apply), but is recorded here so users and tooling
   * can distinguish npm-artefact files from wired reference-pack files when
   * inspecting the overlay directory or reading OpenCode's OVERLAY log output.
   */
  npmInstallSummary?: {
    /** Workspace-relative path of the package.json driving the install. */
    packageJsonPath: string;
    /** Number of top-level dependency declarations in package.json. */
    declaredDependencyCount: number;
    /**
     * Approximate number of packages installed (best-effort from
     * package-lock.json packages entries, or a conservative estimate when
     * unavailable). This is a package count, not a filesystem file count.
     */
    estimatedPackageCount: number;
  };
  notes: string[];
}

/**
 * Describes wire preview manifest data exchanged by the lifecycle pipeline.
 */
export interface WirePreviewManifest {
  schemaVersion: number;
  host: HostTarget | "vscode" | "opencode";
  mode: "preview" | "apply" | "reset";
  generatedAt: string;
  workspaceRoot: string;
  targetPaths: string[];
  notes: string[];
}
