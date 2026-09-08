# Shared and Cross-Host Compatibility

Agent Harness uses two related host concepts that must not be confused:

1. **Registered lifecycle/recommendation adapters** are concrete CLI targets such as `copilot-vscode`, `cursor`, `opencode`, `zed`, `claude-code`, `pi`, and `codex`. These adapters own preview/apply/reset behavior and declare which asset kinds they can stage or wire.
2. **`shared` is a catalog compatibility/source tag.** It is not a registered lifecycle adapter and is not a valid `wire`, `workspace`, `activate host`, or `setup doctor --host` target.

## Why `shared` exists

Some artifacts are portable by design. The canonical example is an MCP server: a single server definition can be useful to several registered hosts even though each host has a different native configuration surface. Discovery can therefore catalog the asset with `hosts: ["shared"]` and derive concrete `compatibleHosts` from the compatibility matrix.

`shared` means **“this asset is not owned by one host-specific source format.”** It does **not** mean that Agent Harness bypasses adapter validation or writes one universal host configuration.

## How compatibility is resolved

At recommendation time, Agent Harness checks both the asset's declared `hosts` and any inferred `compatibleHosts`. A concrete host is eligible only when:

- the compatibility matrix permits that asset kind for the concrete registered host; and
- the concrete adapter's capability table permits the requested behavior (`stage`, `wire`, or both).

The adapter remains the enforcement boundary. `shared` never grants behavior on its own.

### MCP example

An MCP server may be cataloged as `shared`. Compatibility inference can expose it to registered MCP-capable hosts such as OpenCode, Codex, Claude Code, VS Code/Copilot, Cursor, and Zed when their adapter matrices support MCP. Pi currently stages MCP references but does not advertise MCP wire behavior; `shared` does not override that limitation.

The result is one portable catalog identity with several concrete host execution paths, each using the host's actual native MCP configuration format.

### VS Code extension example

A VS Code extension is native to the `copilot-vscode` host family. Agent Harness may infer **partial** compatibility for Cursor because Cursor supports a substantial VS Code extension surface. That inference does not create a generic `shared` extension host, does not imply Zed compatibility, and does not mean every VS Code extension is guaranteed to work in Cursor.

## What `shared` does not imply

- It does not register a `shared` CLI adapter.
- It does not make every asset compatible with every host.
- It does not convert unsupported asset kinds into native formats.
- It does not make stage-only capabilities wireable.
- It does not bypass host preflight, risk, trust, or install-eligibility checks.
- It does not guarantee behavioral equivalence between hosts that can consume the same asset.

## Operational checks

Use these commands to inspect the concrete execution surface:

```text
agent-harness setup hosts
agent-harness setup doctor --host <host>
agent-harness recommend report
agent-harness recommend explain --asset <asset-id>
agent-harness wire <host> --preview
```

`setup hosts` is authoritative for registered adapters and their wire capabilities. Recommendation output explains compatibility and selection; `wire --preview` shows the concrete files the selected adapter would manage before any mutation occurs.

## Maintenance rule

When a new registered host is added, update the compatibility matrix and adapter capabilities together and add a regression proving every concrete compatibility target resolves to a registered adapter. Do not add a concrete host name only to a catalog matrix without registering it, and do not treat `shared` as a shortcut for missing adapter support.
