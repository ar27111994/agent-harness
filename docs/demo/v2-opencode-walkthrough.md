# v2 OpenCode demo walkthrough

This walkthrough is the reproducible v2 demo path for `agent-harness`. It shows the full value chain on a small public-safe workspace: demand detection, source selection, recommendations, mirror locks, stage/install state, activation, quarantine boundaries, and project-local OpenCode wire-in.

The demo intentionally uses a throwaway workspace and bounded fixture outputs so screenshots, terminal recordings, and docs can be regenerated without private paths, secrets, live GitHub rate limits, or workstation-specific host state.

## What this demo proves

- A user can start from a clean workspace and run the same OpenCode quick-start command shape.
- Generated lifecycle artifacts are discoverable under `.agent-harness/`.
- The before/after host wiring is visible in normal project files.
- Quarantine/security behavior is part of the story, not hidden behind successful CLI output.
- The recording source is deterministic enough for CI/doc tests, while the command sequence matches the installed package flow.

## Demo workspace

The script creates `.tmp/demo-workspace-opencode-<pid>/` with:

```text
package.json
README.md
src/server.ts
```

The fixture is a tiny TypeScript API workspace with `express`, `zod`, and `typescript` signals. It has no `.env`, no tokens, no private repository URLs, and no personal project names.

## Command sequence to record

> **First-run timing:** the first `discover full` run performs a live source
> sync that takes ~1–2 minutes (demand-filtered). If a 120-second command
> timeout is in play, use `discover full --no-sync` for the recording and
> note that the catalog then reflects cached sync state. Per-source sync
> progress (with remaining-time estimates) prints to stderr.

From the repository root after dependencies and build output exist:

```bash
npm install
npm run build
node docs/demo/workspace-opencode-demo.mjs
```

The transcript shows the installed-package command a user should run from a clean workspace:

```bash
agent-harness workspace opencode --intent general
```

The script also verifies the built CLI can enumerate the registered host adapters:

```bash
node dist/cli.js --state-root .agent-harness setup hosts
```

## Expected lifecycle outputs

The demo tree should include these key files:

| Phase            | Expected artifact                                                     | Why it matters                                                 |
| ---------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Demand detection | `.agent-harness/discover/output/demand-profile.json`                  | Shows detected workspace intent/signals before recommendation. |
| Source inventory | `.agent-harness/discover/output/source-index.json`                    | Shows which sources were considered.                           |
| Selection        | `.agent-harness/discover/output/selection-report.json`                | Shows selected vs rejected catalog entries.                    |
| Recommendation   | `.agent-harness/state/recommendations.json`                           | Shows host-specific ranked assets.                             |
| Mirror           | `.agent-harness/mirror/bundles/opencode-global.lock.json`             | Shows pinned bundle state before staging.                      |
| Activation       | `.agent-harness/activate/opencode/activation-manifest.json`           | Shows active assets for the OpenCode lifecycle host.           |
| Wire preview     | `.agent-harness/activate/opencode/wire-preview-opencode.json`         | Shows planned target paths before mutation.                    |
| Wire apply       | `.opencode/context/project-intelligence/agent-harness/wire-plan.json` | Shows effective project-local OpenCode wiring.                 |
| Project context  | `AGENTS.md`                                                           | Shows the managed OpenCode context section after apply.        |

## Before and after host wiring

Before wire-in, the demo workspace has no OpenCode project overlay and no managed `AGENTS.md` section:

```text
package.json
README.md
src/server.ts
```

After OpenCode wire-in, the visible project-level changes are:

```text
AGENTS.md
.opencode/context/project-intelligence/agent-harness/wire-plan.json
.agent-harness/activate/opencode/wire-preview-opencode.json
```

`AGENTS.md` contains only an `agent-harness` managed section in the demo fixture. In a real workspace, apply/reset should preserve unrelated user-authored content around managed markers.

## What was selected, skipped, quarantined, staged, activated, and wired

The deterministic fixture summarizes the lifecycle like this:

- **Selected:** `repo-guide` and `api-reviewer` style assets that match the TypeScript/API workspace signals.
- **Skipped/rejected:** unrelated catalog candidates from the selection report.
- **Quarantined:** no asset is approved from quarantine in the demo; the walkthrough calls out that risky hooks, MCP servers, executable plugins, and prompt-injection-like content remain review-gated.
- **Staged:** selected OpenCode bundle entries are represented by `opencode-global.lock.json` and staged lifecycle state.
- **Activated:** selected assets appear in `activation-manifest.json` for the OpenCode lifecycle host.
- **Wired:** OpenCode receives project-local context through `AGENTS.md` and `.opencode/context/project-intelligence/agent-harness/`.

## Quarantine and risk behavior to point out in recordings

The happy-path demo should explicitly mention this security boundary:

- `workspace opencode` can produce reports, locks, staged packages, activation manifests, and project-local managed context.
- It does **not** silently approve quarantine.
- It does **not** silently install native/global extensions.
- It does **not** silently enable executable hooks, MCP servers, plugins, custom tools, OAuth/login, or global host config.
- Use `docs/guides/TRUST-CENTER.md` and `docs/playbooks/QUARANTINE-PLAYBOOK.md` before approving anything executable or ambiguous.

If a future recording uses a live fixture containing a risky asset, show `agent-harness quarantine list` and `agent-harness quarantine inspect --asset <asset-id>` instead of approving it.

## Screenshot / GIF guidance

A useful terminal GIF should show:

1. the clean demo workspace path under `.tmp/`
2. `agent-harness workspace opencode --intent general`
3. the 11 lifecycle phases completing
4. `setup hosts` proving the current host adapter inventory
5. a compact tree of `.agent-harness/`, `.opencode/`, and `AGENTS.md`

Do not record:

- real home directories outside the throwaway workspace
- `.env` contents
- GitHub/npm/OpenAI/Anthropic tokens
- private source URLs
- unrelated global host config roots

If the final GIF/video is too large for git, upload it as a GitHub Release asset and link it from the README while keeping `workspace-opencode-demo.mjs` as the reproducible source.

## Troubleshooting

- If `dist/cli.js` is missing, run `npm run build` first.
- If live discovery is rate-limited, use the deterministic script output for the recording source and rerun the real quick-start later for comparison.
- If generated files differ, inspect `.agent-harness/discover/output/source-health.json`, `.agent-harness/discover/output/source-drift.json`, and `.agent-harness/state/recommendations.json` before updating the recording.
- If a risky asset appears, stop at preview/report output and follow `docs/playbooks/QUARANTINE-PLAYBOOK.md`.
