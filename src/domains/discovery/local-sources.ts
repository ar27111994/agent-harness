import { join } from "node:path";

import type { SourceDefinition } from "../../types.js";
import { resolveDefaultOpenCodeConfigRoot } from "../../lib/paths.js";

/**
 * Builds generated local sources from the provided inputs.
 */
export function buildGeneratedLocalSources(): SourceDefinition[] {
  const openCodeRoot = resolveDefaultOpenCodeConfigRoot();

  return [
    {
      id: "local-antigravity-manifest",
      name: "Local Antigravity Install Manifest",
      kind: "local-manifest",
      authorityTier: "trusted-local",
      publisher: { name: "local" },
      hosts: ["copilot-vscode", "opencode"],
      assetKinds: ["skill", "plugin", "agent"],
      discoveryMode: "seed",
      priority: 95,
      enabled: true,
      endpoints: {
        file: "~/.agents/skills/.antigravity-install-manifest.json",
      },
      rules: {
        officialPreferred: true,
        allowMirror: true,
        allowInstall: true,
      },
    },
    {
      id: "local-antigravity-skills",
      name: "Local Antigravity Skills Directory",
      kind: "local-directory",
      authorityTier: "trusted-local",
      publisher: { name: "local-antigravity" },
      hosts: ["copilot-vscode", "opencode"],
      assetKinds: ["skill"],
      discoveryMode: "seed",
      priority: 96,
      enabled: true,
      endpoints: {
        path: "~/.agents/skills",
      },
      rules: {
        officialPreferred: true,
        allowMirror: true,
        allowInstall: true,
      },
    },
    {
      id: "local-opencode-config",
      name: "Local OpenCode Config",
      kind: "local-directory",
      authorityTier: "trusted-local",
      publisher: { name: "local" },
      hosts: ["opencode"],
      assetKinds: [
        "skill",
        "plugin",
        "agent",
        "workflow",
        "hook",
        "instruction",
      ],
      discoveryMode: "seed",
      priority: 100,
      enabled: true,
      endpoints: {
        path: openCodeRoot,
      },
      rules: {
        officialPreferred: true,
        allowMirror: true,
        allowInstall: true,
      },
    },
    {
      id: "local-opencode-context",
      name: "Local OpenCode Context",
      kind: "local-directory",
      authorityTier: "trusted-local",
      publisher: { name: "local" },
      hosts: ["opencode"],
      assetKinds: ["instruction", "workflow", "reference-pack"],
      discoveryMode: "seed",
      priority: 90,
      enabled: true,
      endpoints: {
        path: join(openCodeRoot, "context"),
      },
      rules: {
        officialPreferred: true,
        allowMirror: true,
        allowInstall: true,
      },
    },
  ];
}
