import type { AssetKind, HostTarget } from "../types.js";

/**
 * Describes a cross-host compatibility relationship for a catalog asset.
 * When `installDiffers` is true, the asset's install command is host-specific
 * and the wire step must emit host-specific instructions.
 */
export interface CompatibleHost {
  /** The compatible host identifier. */
  host: HostTarget;
  /** Level of compatibility: "full" = protocol-level interop, "partial" = known limitations. */
  compatibility: "full" | "partial";
  /** Short human-readable note about caveats or differences, if any. */
  notes?: string;
  /** True when the install command or config path differs from the primary host. */
  installDiffers?: boolean;
}

/**
 * MCP servers are protocol-level interoperable with all major MCP-capable hosts.
 * Config path and install mechanism differ per host, so `installDiffers: true`.
 */
export const MCP_COMPATIBLE_HOSTS: CompatibleHost[] = [
  {
    host: "cursor",
    compatibility: "full",
    notes: "Cursor supports MCP via .cursor/mcp.json; install command differs.",
    installDiffers: true,
  },
  {
    host: "zed",
    compatibility: "full",
    notes:
      "Zed supports MCP via .zed/settings.json context_servers; also forwards to ACP agents.",
    installDiffers: true,
  },
  {
    host: "opencode",
    compatibility: "full",
    notes:
      "OpenCode supports MCP via opencode.json mcp block; install command differs.",
    installDiffers: true,
  },
  {
    host: "claude-code",
    compatibility: "full",
    notes:
      "Claude Code supports MCP via .mcp.json or .claude/settings.json; standard stdio/SSE transport.",
    installDiffers: true,
  },
  {
    host: "codex",
    compatibility: "full",
    notes:
      "Codex supports MCP via .codex/config.toml; install command differs.",
    installDiffers: true,
  },
];

/**
 * VS Code extensions are partially compatible with Cursor.
 * Extensions using standard VS Code APIs work; those relying on specific runtime
 * features (debugger, notebook APIs) may not.
 */
export const VSCODE_EXTENSION_COMPATIBLE_HOSTS: CompatibleHost[] = [
  {
    host: "cursor",
    compatibility: "partial",
    notes:
      "Cursor supports VS Code Marketplace extensions; extensions using VS Code-specific runtime APIs may not work.",
    installDiffers: true,
  },
  {
    host: "windsurf",
    compatibility: "partial",
    notes:
      "Windsurf supports VS Code Marketplace extensions via its VS Code compatibility layer.",
    installDiffers: true,
  },
];

/**
 * ACP agents are compatible across JetBrains and Zed surfaces via
 * the Agent Client Protocol (https://www.jetbrains.com/acp/).
 * Zed also forwards these to external ACP agents in the same session.
 */
export const ACP_COMPATIBLE_HOSTS: CompatibleHost[] = [
  {
    host: "zed",
    compatibility: "full",
    notes:
      "Zed supports ACP agents and forwards MCP servers to external agents in-session.",
    installDiffers: false,
  },
];

/**
 * Returns auto-inferred cross-host compatible entries for an asset based on its kind.
 * Results are always a copy — callers may extend or override the array freely.
 *
 * Rules:
 * - `mcp-server` → compatible with all MCP-capable hosts.
 * - `extension` → compatible with Cursor and Windsurf (partial).
 * - `acp-agent` → compatible with Zed (full).
 * - All other kinds → empty (no auto-inferred compatibility).
 */
export function inferCompatibleHosts(
  assetKind: AssetKind,
  primaryHosts: HostTarget[],
): CompatibleHost[] {
  const compatible: CompatibleHost[] = [];

  if (assetKind === "mcp-server") {
    for (const entry of MCP_COMPATIBLE_HOSTS) {
      // Don't add a host that's already in the primary hosts list
      if (!primaryHosts.includes(entry.host)) {
        compatible.push({ ...entry });
      }
    }
  }

  if (assetKind === "extension") {
    for (const entry of VSCODE_EXTENSION_COMPATIBLE_HOSTS) {
      if (!primaryHosts.includes(entry.host)) {
        compatible.push({ ...entry });
      }
    }
  }

  if (assetKind === "acp-agent") {
    for (const entry of ACP_COMPATIBLE_HOSTS) {
      if (!primaryHosts.includes(entry.host)) {
        compatible.push({ ...entry });
      }
    }
  }

  return compatible;
}

/**
 * Returns true if the given host appears in a `compatibleHosts` list.
 */
export function isHostInCompatibleHosts(
  compatibleHosts: CompatibleHost[] | undefined,
  host: HostTarget,
): boolean {
  if (!compatibleHosts) return false;
  return compatibleHosts.some((c) => c.host === host);
}

/**
 * Returns the compatibility entry for a specific host from a `compatibleHosts` list,
 * or null if the host is not present.
 */
export function getCompatibleHostEntry(
  compatibleHosts: CompatibleHost[] | undefined,
  host: HostTarget,
): CompatibleHost | null {
  if (!compatibleHosts) return null;
  return compatibleHosts.find((c) => c.host === host) ?? null;
}
