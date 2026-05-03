import type { AssetCatalogEntry, AssetKind, HostTarget } from "../types.js";
import { wireOpenCode } from "./opencode.js";
import { wireVsCode } from "./vscode.js";
import { wireNativeHost } from "./native-wire.js";
import {
  buildExtensionInstallActions,
  buildVsCodeExtensionInstallActions,
  resolveVsCodeExtensionId,
  type ExtensionInstallAction,
} from "./extension-installer.js";

export type LifecycleHost = "copilot-vscode" | "opencode";
export type WireMode = "preview" | "apply" | "reset";
export type HostBehavior =
  | "stage"
  | "wire"
  | "native-install"
  | "auth-assist"
  | "runtime-validation";

export interface HostCapability {
  assetKind: AssetKind;
  behaviors: HostBehavior[];
}

export interface HostRuntimeSpec {
  executable: string;
  versionArgs?: string[];
  readinessArgs?: string[];
  guidance?: string;
  requiredFor?: HostBehavior[];
}

export interface HostNativeInstallProvider {
  assetKind: AssetKind;
  collectActions(assets: AssetCatalogEntry[]): ExtensionInstallAction[];
}

export interface HostAdapter {
  id: string;
  aliases: string[];
  displayName: string;
  lifecycleHost: LifecycleHost;
  recommendationHost: HostTarget;
  defaultBundleIds: string[];
  mutatesHostPaths: boolean;
  requiresLifecycleHostPaths?: boolean;
  runtime?: HostRuntimeSpec;
  nativeInstall?: HostNativeInstallProvider;
  capabilities: HostCapability[];
  wire(options: {
    projectRoot: string;
    workspaceRoot: string;
    mode: WireMode;
  }): Promise<void>;
}

const vscodeCapabilities: HostCapability[] = [
  { assetKind: "instruction", behaviors: ["stage", "wire"] },
  { assetKind: "agent", behaviors: ["stage", "wire"] },
  { assetKind: "skill", behaviors: ["stage", "wire"] },
  { assetKind: "workflow", behaviors: ["stage"] },
  { assetKind: "plugin", behaviors: ["stage", "wire"] },
  { assetKind: "hook", behaviors: ["stage", "wire"] },
  {
    assetKind: "extension",
    behaviors: ["stage", "native-install", "runtime-validation"],
  },
  { assetKind: "mcp-server", behaviors: ["stage", "wire", "auth-assist"] },
];

const opencodeCapabilities: HostCapability[] = [
  { assetKind: "instruction", behaviors: ["stage", "wire"] },
  { assetKind: "agent", behaviors: ["stage", "wire"] },
  { assetKind: "skill", behaviors: ["stage", "wire"] },
  { assetKind: "plugin", behaviors: ["stage", "wire"] },
  { assetKind: "hook", behaviors: ["stage", "wire"] },
  { assetKind: "workflow", behaviors: ["stage", "wire"] },
  { assetKind: "reference-pack", behaviors: ["stage", "wire"] },
  { assetKind: "mcp-server", behaviors: ["stage", "wire", "auth-assist"] },
];

const cursorCapabilities: HostCapability[] = vscodeCapabilities;

const piCapabilities: HostCapability[] = opencodeCapabilities.map(
  (capability) =>
    capability.assetKind === "mcp-server"
      ? { assetKind: capability.assetKind, behaviors: ["stage"] }
      : capability,
);

const DEFAULT_HOST_ADAPTERS: HostAdapter[] = [
  {
    id: "copilot-vscode",
    aliases: ["vscode", "copilot"],
    displayName: "GitHub Copilot in VS Code",
    lifecycleHost: "copilot-vscode",
    recommendationHost: "copilot-vscode",
    defaultBundleIds: ["copilot-core", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: true,
    runtime: {
      executable: "code",
      readinessArgs: ["--list-extensions", "--show-versions"],
      guidance:
        "Install the VS Code CLI and ensure the 'code' command is available on PATH for native extension install and verification.",
      requiredFor: ["native-install", "runtime-validation"],
    },
    nativeInstall: {
      assetKind: "extension",
      collectActions: (assets) =>
        buildVsCodeExtensionInstallActions(
          assets.flatMap((asset) => {
            const extensionId = resolveVsCodeExtensionId(asset);
            return extensionId ? [extensionId] : [];
          }),
        ),
    },
    capabilities: vscodeCapabilities,
    wire: wireVsCode,
  },
  {
    id: "opencode",
    aliases: ["open-code"],
    displayName: "OpenCode",
    lifecycleHost: "opencode",
    recommendationHost: "opencode",
    defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    runtime: {
      executable: "opencode",
      guidance:
        "Install the OpenCode CLI if you want runtime validation beyond project-local overlay wiring.",
    },
    capabilities: opencodeCapabilities,
    wire: wireOpenCode,
  },
  {
    id: "cursor",
    aliases: [],
    displayName: "Cursor",
    lifecycleHost: "copilot-vscode",
    recommendationHost: "cursor",
    defaultBundleIds: ["copilot-core", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    runtime: {
      executable: "cursor",
      readinessArgs: ["--list-extensions", "--show-versions"],
      guidance:
        "Install the Cursor CLI if you want runtime validation and native extension install/verification beyond project-local file wiring.",
      requiredFor: ["native-install", "runtime-validation"],
    },
    nativeInstall: {
      assetKind: "extension",
      collectActions: (assets) =>
        buildExtensionInstallActions({
          executable: "cursor",
          host: "cursor",
          extensionIds: assets.flatMap((asset) => {
            const extensionId = resolveVsCodeExtensionId(asset);
            return extensionId ? [extensionId] : [];
          }),
        }),
    },
    capabilities: cursorCapabilities,
    wire: (options) => wireNativeHost("cursor", options),
  },
  {
    id: "zed",
    aliases: [],
    displayName: "Zed",
    lifecycleHost: "opencode",
    recommendationHost: "zed",
    defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    runtime: {
      executable: "zed",
      guidance:
        "Install the Zed CLI if you want runtime validation beyond project-local file wiring.",
    },
    capabilities: opencodeCapabilities,
    wire: (options) => wireNativeHost("zed", options),
  },
  {
    id: "claude-code",
    aliases: ["claude", "claudecode"],
    displayName: "Claude Code",
    lifecycleHost: "opencode",
    recommendationHost: "claude-code",
    defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    runtime: {
      executable: "claude",
      guidance:
        "Install the Claude Code CLI if you want runtime validation beyond project-local file wiring.",
    },
    capabilities: opencodeCapabilities,
    wire: (options) => wireNativeHost("claude-code", options),
  },
  {
    id: "pi",
    aliases: ["pi-coding-agent"],
    displayName: "Pi",
    lifecycleHost: "opencode",
    recommendationHost: "pi",
    defaultBundleIds: ["opencode-global", "community-stable"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    runtime: {
      executable: "pi",
      guidance:
        "Install the Pi CLI if you want runtime validation beyond project-local file wiring.",
    },
    capabilities: piCapabilities,
    wire: (options) => wireNativeHost("pi", options),
  },
];

const hostAdapters = [...DEFAULT_HOST_ADAPTERS];

export function registerHostAdapter(adapter: HostAdapter): void {
  const normalizedId = adapter.id.toLowerCase();
  const existingIndex = hostAdapters.findIndex(
    (registeredAdapter) => registeredAdapter.id === normalizedId,
  );
  const normalizedAdapter = {
    ...adapter,
    id: normalizedId,
    aliases: adapter.aliases.map((alias) => alias.toLowerCase()),
  };

  if (existingIndex >= 0) {
    hostAdapters[existingIndex] = normalizedAdapter;
    return;
  }

  hostAdapters.push(normalizedAdapter);
}

/**
 * Resolves a user-facing host target or alias to its registered adapter.
 */
export function resolveHostAdapter(target: string): HostAdapter | null {
  const normalizedTarget = target.toLowerCase();
  return (
    hostAdapters.find(
      (adapter) =>
        adapter.id === normalizedTarget ||
        adapter.aliases.includes(normalizedTarget),
    ) ?? null
  );
}

/**
 * Returns a snapshot of all registered host adapters.
 */
export function listHostAdapters(): HostAdapter[] {
  return [...hostAdapters];
}

/**
 * Checks whether a catalog entry can be recommended for a host by combining
 * direct host tags, lifecycle-host reuse, and the adapter capability matrix.
 */
export function isHostCompatibleWithRecommendationHost(
  entryHosts: HostTarget[],
  recommendationHost: HostTarget,
  assetKind: AssetKind,
): boolean {
  const adapter = getAdapterForRecommendationHost(recommendationHost);
  if (
    adapter &&
    !adapter.capabilities.some(
      (capability) => capability.assetKind === assetKind,
    )
  ) {
    return false;
  }

  if (entryHosts.includes(recommendationHost)) {
    return true;
  }

  return adapter ? entryHosts.includes(adapter.lifecycleHost) : false;
}

/**
 * Finds the adapter whose recommendation policy owns the requested host id.
 */
function getAdapterForRecommendationHost(
  recommendationHost: HostTarget,
): HostAdapter | null {
  return (
    hostAdapters.find(
      (adapter) => adapter.recommendationHost === recommendationHost,
    ) ?? null
  );
}
