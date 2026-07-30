# Adapter Development Guide

How to create a new host adapter for `agent-harness`. This guide walks through
registration, lifecycle wiring, capability matrix, and testing — with a worked
example for a hypothetical Windsurf adapter.

## Architecture Overview

A host adapter translates agent-harness asset recommendations into host-native
configurations. Each adapter handles:

1. **Lifecycle host** — which lifecycle bundles the host consumes (e.g. `opencode`,
   `copilot-vscode`, `shared-mcp`)
2. **Wire target** — how activated assets are wired into a workspace
3. **Native config** — host-specific JSON/text file payloads (MCP servers, skills,
   instructions)
4. **Preflight diagnostics** — whether the host CLI is installed and accessible
5. **Install/verify/remove** — optional host-native install operations

## Step-by-Step Walkthrough

### 1. Choose a Host Identifier

Pick a unique `id` for your adapter (e.g. `"windsurf"`). This becomes the CLI
command target:

```bash
agent-harness workspace windsurf
agent-harness wire windsurf --preview
```

### 2. Create the Adapter Module

Create `src/host-adapters/windsurf.ts`:

```typescript
import type { HostAdapter, HostAdapterModule } from "./types.js";
import { collectActivatedAssetPrerequisiteDiagnostics } from "../lib/asset-prerequisites.js";

const adapter: HostAdapter = {
  id: "windsurf",
  displayName: "Windsurf",
  aliases: ["windsurf-ide"],
  lifecycleHost: "opencode",
  wireHost: "windsurf" as HostTarget,
  hostKind: "native",
  mutatesHostPaths: true,
  supportedAssetKinds: [
    "skill",
    "mcp-server",
    "plugin",
    "agent",
    "instruction",
  ],
  requiresLifecycleHostPaths: true,
  hostNativeConfig: buildWindsurfNativeConfig,
  hostCommands: {
    preflight: {
      command: "windsurf",
      args: ["--version"],
      timeoutMs: 5000,
    },
  },
};

async function buildWindsurfNativeConfig(
  context: HostNativeConfigContext,
): Promise<AssetHostNativeConfig> {
  // ... implement native config generation
}

export default {
  adapter,
  buildNativeConfig: buildWindsurfNativeConfig,
} satisfies HostAdapterModule;
```

### 3. Register in the Adapter Registry

Add your adapter to `src/host-adapters/registry.ts`:

```typescript
// In the registry's loadAdapters() or static list:
import windsurfModule from "./windsurf.js";

const adapters: HostAdapterModule[] = [
  // ... existing adapters
  windsurfModule,
];
```

### 4. Define the Lifecycle Contract

| Concept               | Value        | Why                                         |
| --------------------- | ------------ | ------------------------------------------- |
| `lifecycleHost`       | `"opencode"` | Reuses OpenCode-compatible bundle structure |
| `wireHost`            | `"windsurf"` | Unique wire target for file placement       |
| `mutatesHostPaths`    | `true`       | Adapter writes files to workspace           |
| `supportedAssetKinds` | `[...]`      | Which asset types this host can consume     |

Lifecycle hosts determine which bundles assets are sourced from:

- `copilot-vscode` — VS Code / Copilot bundles
- `opencode` — OpenCode-compatible bundles (used by Cursor, Zed, Claude Code, Pi, Codex)
- `shared-mcp` — Cross-host MCP server bundles

### 5. Implement Native Configuration

Each activated asset can produce host-native file payloads. For Windsurf, this
might mean writing `.windsurf/mcp.json` and `.windsurf/skills.json`:

```typescript
async function buildWindsurfNativeConfig(
  context: HostNativeConfigContext,
): Promise<AssetHostNativeConfig> {
  const mcpServers: Record<string, unknown> = {};
  const skills: Record<string, { path: string }> = {};

  for (const [assetId, asset] of Object.entries(context.activatedAssets)) {
    if (asset.assetKind === "mcp-server") {
      mcpServers[assetId] = {
        command: asset.install.manifestEntry ?? asset.id,
        args: [],
      };
    }
    if (asset.assetKind === "skill") {
      skills[assetId] = {
        path: `.windsurf/skills/${assetId}.md`,
      };
    }
  }

  return {
    files: [
      {
        path: ".windsurf/mcp.json",
        format: "json",
        content: { mcpServers },
      },
      {
        path: ".windsurf/skills.json",
        format: "json",
        content: { skills },
      },
    ],
  };
}
```

### 6. Implement the Wire-in Handler

The `wire` step places generated native config files into the workspace. For
Windsurf, this follows the same pattern as other opencode-hosted adapters:

- Preview mode: print the planned file paths and diff against existing files
- Apply mode: write the files to the workspace
- Reset mode: remove the adapter's files from the workspace

The wire-in is handled by the shared `native-wire.ts` infrastructure — your
adapter just needs to declare `mutatesHostPaths: true` and provide
`hostNativeConfig`.

### 7. Add Preflight Diagnostics

Preflight checks verify the host CLI is installed:

```typescript
hostCommands: {
  preflight: {
    command: "windsurf",
    args: ["--version"],
    timeoutMs: 5000,
  },
},
```

The `setup doctor` command runs all adapter preflights concurrently. A
per-adapter timeout (`AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS`, default 5s)
prevents a hanging CLI from blocking the entire check.

### 8. Add Install/Verify/Remove (Optional)

If your host supports programmatic install of extensions/plugins:

```typescript
hostCommands: {
  install: {
    command: "windsurf",
    args: ["extension", "install"],
    installArgTemplate: "${extensionId}",
  },
  verify: {
    command: "windsurf",
    args: ["extension", "list", "--installed"],
    verifyMatchPattern: "${extensionId}",
  },
  remove: {
    command: "windsurf",
    args: ["extension", "uninstall"],
    removeArgTemplate: "${extensionId}",
  },
},
```

### 9. Add Recommendation Policy

Create a recommendation policy file at
`discover/recommendation-policy/windsurf.json`:

```json
{
  "recommendationLimit": 80,
  "maxPerAssetKind": {
    "mcp-server": 15,
    "skill": 40,
    "plugin": 10,
    "agent": 10,
    "instruction": 5
  },
  "targetMinimums": {
    "skill": 8,
    "mcp-server": 4
  }
}
```

### 10. Register the Host in Compatibility Matrix

Add your host to `src/host-adapters/compatibility-matrix.ts`:

```typescript
export const COMPATIBLE_HOSTS: Record<HostTarget, CompatibleHost[]> = {
  // ... existing entries
  windsurf: [{ hostId: "windsurf", installDiffers: false }],
};
```

### 11. Add Workspace and Wire CLI Targets

In `src/workspace.ts` and `src/wire.ts`, the host adapter registry is already
queried dynamically — no code changes needed beyond registration. The CLI
automatically picks up new adapters from the registry.

### 12. Test Your Adapter

Create `src/tests/host-adapters/windsurf.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveHostAdapter } from "../../host-adapters/registry.js";
import windsurfModule from "../../host-adapters/windsurf.js";

void test("windsurf adapter is registered", () => {
  const adapter = resolveHostAdapter("windsurf");
  assert.ok(adapter != null);
  assert.equal(adapter.id, "windsurf");
  assert.equal(adapter.lifecycleHost, "opencode");
});

void test("windsurf adapter produces native config", async () => {
  const config = await windsurfModule.buildNativeConfig({
    activatedAssets: {},
    projectRoot: "/tmp/test",
    workingDirectory: "/tmp/test",
  });
  assert.ok(Array.isArray(config.files));
});

void test("windsurf workspace --help shows windsurf-specific help", async () => {
  // Use the built-cli-harness to verify CLI integration
});
```

### 13. Update Documentation

- Add your host to the README [Supported hosts](#supported-hosts) badge row
- Add a row to the host compatibility table in `docs/guides/TRUST-CENTER.md`
- Add your host to the CLI cheat sheet (`docs/cheatsheet.md`)

## Capability Matrix

| Feature                  | Required | Notes                                            |
| ------------------------ | -------- | ------------------------------------------------ |
| Adapter registration     | Yes      | registry.ts entry                                |
| Lifecycle host mapping   | Yes      | Which bundles the host consumes                  |
| Wire host mapping        | Yes      | Where files are placed in the workspace          |
| Native config generation | Yes      | At minimum, an empty config                      |
| Preflight diagnostics    | Yes      | At minimum, report "not checked"                 |
| Recommendation policy    | Yes      | Per-host caps and minimums                       |
| Wire preview/apply/reset | Yes      | Handled by shared infra if mutatesHostPaths=true |
| Install/verify/remove    | No       | Only if host supports programmatic install       |
| Compatibility matrix     | Yes      | CompatibleHost[] entries                         |

## Host Design Checklist

Before submitting, verify:

- [ ] `resolveHostAdapter("my-host")` returns your adapter
- [ ] `setup hosts` lists your adapter with correct display name
- [ ] `workspace my-host --help` shows host-specific help text (#383)
- [ ] `wire my-host --help` shows host-specific help text (#383)
- [ ] `setup doctor --host my-host` runs preflight diagnostics
- [ ] Recommendation policy file exists at `discover/recommendation-policy/my-host.json`
- [ ] Native config produces valid JSON/text payloads
- [ ] Wire preview shows planned files without writing them
- [ ] Wire apply writes files to workspace
- [ ] Wire reset removes adapter files from workspace
- [ ] Tests cover registration, native config generation, and CLI integration
- [ ] README and docs updated

## See Also

- [Host Adapter Types](../src/host-adapters/types.ts) — full type definitions
- [Registry](../src/host-adapters/registry.ts) — adapter registration
- [Native Config](../src/host-adapters/native-config.ts) — shared config generation
- [Native Wire](../src/host-adapters/native-wire.ts) — wire-in infrastructure
- [V2 CLI Contract](./V2-CONTRACT.md) — host lifecycle model
- [Contributing Guide](../CONTRIBUTING.md) — contribution workflow
