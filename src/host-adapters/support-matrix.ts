import { ASSET_KINDS } from "../manifest-validation/primitives.js";
import type { AssetKind } from "../types.js";
import { listHostAdapters, type HostAdapter } from "./registry.js";

/**
 * Defines a normalized host support matrix row for documentation and tests.
 */
export interface HostSupportMatrixRow {
  cliTarget: string;
  displayName: string;
  aliases: string[];
  lifecycleHost: string;
  recommendationHost: string;
  defaultBundles: string[];
  discoverAwareSignals: boolean;
  stageInstallSupport: "stage" | "stage-plus-native-install";
  activateSupport: boolean;
  wirePreview: boolean;
  wireApply: boolean;
  wireReset: boolean;
  nativeInstallVerifyRemove: string[];
  projectLocalNativeWiring: boolean;
  quarantineAwareBehavior: string;
  supportedAssetKinds: AssetKind[];
  knownLimitations: string[];
}

const LIMITATIONS_BY_HOST: Record<string, string[]> = {
  "copilot-vscode": [
    "Requires a writable VS Code user settings directory for apply/reset.",
    "Marketplace extension install/verify/remove is explicit and never part of wire apply.",
  ],
  opencode: [
    "Uses project-local overlays and does not mutate global OpenCode packages or global MCP settings.",
    "MCP and tool config synthesis requires explicit structured native payloads.",
  ],
  cursor: [
    "Reuses the Copilot lifecycle store while applying Cursor-specific project files.",
    "Cursor extension install/verify/remove requires the Cursor CLI and explicit native-install operations.",
    "Project plugin registration remains user/host managed.",
  ],
  zed: [
    "Extension installation remains manual through Zed unless future structured native support is added.",
    "Managed .zed/agent-harness assets are references, not a claim that every asset kind is a native Zed directory.",
  ],
  "claude-code": [
    "MCP, hook, and settings synthesis requires explicit structured Claude-native payloads.",
    "Global Claude Code profile/configuration is not modified.",
  ],
  pi: [
    "Pi does not include shared-mcp in its default bundles.",
    "MCP assets are staged as references because Pi has no built-in MCP support in the current adapter contract.",
  ],
  codex: [
    "Global Codex config, plugin caches, automations, remote connections, and sandbox settings are not modified.",
    "Plugin, MCP, hook, and rules activation requires structured Codex-native config and trusted-project review.",
  ],
};

/**
 * Builds the checked-in v2 host support matrix from registered adapter metadata.
 */
export function buildHostSupportMatrix(
  adapters: HostAdapter[] = listHostAdapters(),
): HostSupportMatrixRow[] {
  return adapters.map((adapter) => {
    const nativeInstallVerifyRemove = adapter.nativeInstall
      ? [adapter.nativeInstall.assetKind]
      : [];

    return {
      cliTarget: adapter.id,
      displayName: adapter.displayName,
      aliases: [...adapter.aliases],
      lifecycleHost: adapter.lifecycleHost,
      recommendationHost: adapter.recommendationHost,
      defaultBundles: [...adapter.defaultBundleIds],
      discoverAwareSignals: true,
      stageInstallSupport:
        nativeInstallVerifyRemove.length > 0
          ? "stage-plus-native-install"
          : "stage",
      activateSupport: true,
      wirePreview: true,
      wireApply: true,
      wireReset: true,
      nativeInstallVerifyRemove,
      projectLocalNativeWiring: adapter.id !== "copilot-vscode",
      quarantineAwareBehavior:
        "Risky mirrored assets stay quarantine/review gated before stage, activation, and wire-in.",
      supportedAssetKinds: ASSET_KINDS.filter((assetKind) =>
        adapter.capabilities.some(
          (capability) => capability.assetKind === assetKind,
        ),
      ),
      knownLimitations: LIMITATIONS_BY_HOST[adapter.id] ?? [],
    } satisfies HostSupportMatrixRow;
  });
}
