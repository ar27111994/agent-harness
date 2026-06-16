# Plan 007: Add AGENTS.md contributor guidance section above generated overlay content

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- AGENTS.md`
> If `AGENTS.md` changed since this plan was written, compare the head section
> structure against the "Current state" description; treat any structural
> mismatch as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `ca36be9`, 2026-06-15

## Why this matters

`AGENTS.md` at the root of the repo is the canonical orientation document for AI coding agents working in this codebase. It is also the standard file coding-agent hosts (Claude Code, Codex, OpenCode, Cursor) look for to understand repo conventions.

Currently the file contains only a machine-generated OpenCode overlay block starting at line 3:

```
# AGENTS
<!-- agent-harness:begin -->
# Agent Harness OpenCode overlay
Managed overlay root: C:/Projects/agent-harness/.opencode
...
```

An AI agent opening this repo cold reads local path references and linked asset lists — not the project's build commands, conventions, safety rules, or structural overview. This means every new agent session must rediscover the basics the hard way, and any agent following the file literally will try to reference stale local overlay paths.

The generated overlay block is correct to exist (it is the output of agent-harness itself wiring the host). The problem is there is no human/agent-readable preamble before it.

## Current state

`AGENTS.md` head (lines 1–16):

```
# AGENTS

<!-- agent-harness:begin -->
# Agent Harness OpenCode overlay

Managed overlay root: C:/Projects/agent-harness/.opencode
Managed context root: C:/Projects/agent-harness/.opencode/context/...

## Linked assets
- official-index:anthropics:mcp-builder (mcp-server) -> ...
- official-index:cloudflare:agents-sdk (mcp-server) -> ...
...
```

The `<!-- agent-harness:begin -->` / `<!-- agent-harness:end -->` comment markers delimit the generated block that agent-harness manages. Content **outside** those markers is safe to add and will not be overwritten by `agent-harness wire`.

Verify the end marker exists:

```bash
grep -n "agent-harness:end" AGENTS.md
```

## Commands you will need

| Purpose   | Command                | Expected on success                          |
| --------- | ---------------------- | -------------------------------------------- |
| Typecheck | `npm run typecheck`    | exit 0                                       |
| Lint      | `npm run lint`         | exit 0                                       |
| Format    | `npm run format:check` | exit 0 (or run `npm run format` after edits) |

No build or tests required — this is a documentation-only change.

## Scope

**In scope**:

- `AGENTS.md` — add content **before** the `<!-- agent-harness:begin -->` marker only

**Out of scope** (do NOT touch):

- Anything inside or after the `<!-- agent-harness:begin -->` / `<!-- agent-harness:end -->` block
- `src/` — no code changes
- Any other file

## Git workflow

- Branch: `docs/007-agents-md-contributor-guidance`
- Commit message: `docs: add contributor guidance preamble to AGENTS.md`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm the begin/end marker positions

```bash
grep -n "agent-harness:begin\|agent-harness:end" AGENTS.md
```

Note the line numbers. Your edits go before the `begin` marker only.

### Step 2: Insert the contributor guidance preamble

Replace the current head of `AGENTS.md` with the following, then the existing `<!-- agent-harness:begin -->` block unchanged below:

````markdown
# AGENTS

This file serves two purposes:

1. **Contributor guidance** (this section) — conventions, commands, and safety
   rules for humans and AI coding agents working in this repository.
2. **Host overlay** (the managed block below) — machine-generated context
   produced by `agent-harness wire`. Do not edit the managed block directly.

---

## Project overview

`agent-harness` is a CLI and MCP server that manages AI agent assets (skills,
MCP servers, plugins, IDE extensions) across AI coding hosts (VS Code/Copilot,
OpenCode, Cursor, Zed, Claude Code, Pi, Codex). It implements a full
supply-chain lifecycle: Discover → Mirror → Install → Activate → Wire.

## Quick start

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm test             # run all tests (requires dist/)
npm run typecheck    # type-check without emitting
npm run lint         # ESLint (max-warnings=0)
npm run format:check # Prettier check
```
````

Full quality gate: `npm run validate:release` (slow — run before release only).

## Conventions

- **TypeScript strict mode** — `tsconfig.json` has `"strict": true`. No `any`,
  no `@ts-ignore`, no unchecked non-null assertions on paths that can be null.
- **Error handling** — use explicit `throw new Error("...", { cause: error })`
  for chained errors. Never swallow with `.catch(() => undefined)` on
  safety-critical paths. See `src/files.ts:139` for the pattern.
- **Atomic writes** — use `writeJsonFileAtomically` for discovery artifacts.
  Never delete-then-write; always write-to-temp then rename.
- **Module convention** — ESM, `"type": "module"` in `package.json`. Use
  `.js` extensions in imports even when the source is `.ts`.
- **Test pattern** — Node built-in test runner (`node:test`). Tests live in
  `src/tests/`. Model new tests after `src/tests/install-refresh.test.ts`.
- **Path helpers** — use `toPosixPath` from `src/files.ts` for any path that
  may appear in output or comparisons. Use `resolve()` before any path
  containment check.

## Safety rules

- **Never modify `dist/` or `state/` directly** — `dist/` is build output;
  `state/` is runtime state managed by the CLI.
- **Never commit `.env` or credentials** — see `.env.example` for required vars.
- **Wire commands mutate the workspace** — `agent-harness wire <host> --apply`
  writes to the live host config. Use `--dry-run` (preview) first.
- **Activation swap is destructive** — `activate host` replaces the live
  runtime root. If it fails mid-way, run `activate reset` to restore.

## Key directories

| Path                     | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `src/`                   | TypeScript source                       |
| `src/domains/discovery/` | Harvesting, catalog, demand signals     |
| `src/host-adapters/`     | Per-host wire and extension installers  |
| `src/recommend/`         | Selection scoring and report generation |
| `src/mirror/`            | Artifact download and provenance        |
| `src/install/`           | Staged install lifecycle                |
| `src/activate.ts`        | Runtime root swap and rollback          |
| `discover/`              | Source config, policy, and seed JSON    |
| `docs/`                  | Guides, reference, playbooks            |
| `plans/`                 | Advisor implementation plans            |

---

````

Then the existing `<!-- agent-harness:begin -->` block follows unchanged.

**Verify**: `grep -n "agent-harness:begin" AGENTS.md` → still present at the expected (now later) line number

### Step 3: Format

```bash
npm run format
````

Prettier may reformat the markdown. That is expected.

**Verify**: `npm run format:check` → exit 0

### Step 4: Lint

**Verify**: `npm run lint` → exit 0 (AGENTS.md is not linted, but confirm no regression)

## Test plan

Documentation-only change. No code tests. Manual verification:

- [ ] `grep -c "agent-harness:begin" AGENTS.md` → returns `1` (marker still present exactly once)
- [ ] `grep -c "agent-harness:end" AGENTS.md` → returns `1` (end marker intact)
- [ ] The preamble section appears before the begin marker
- [ ] Content between begin/end markers is unchanged: `git diff AGENTS.md` shows only additions before the begin marker

## Done criteria

- [ ] `AGENTS.md` has a contributor guidance section above `<!-- agent-harness:begin -->`
- [ ] The managed overlay block (between begin/end markers) is unchanged
- [ ] `npm run format:check` exits 0
- [ ] `npm run lint` exits 0
- [ ] Only `AGENTS.md` is modified
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report if:

- `AGENTS.md` does not have `<!-- agent-harness:begin -->` / `<!-- agent-harness:end -->` markers — the managed block structure has changed; do not edit until the new boundary is understood.
- `npm run format` produces changes to other files beyond `AGENTS.md` — investigate before committing.

## Maintenance notes

- The preamble you add is **outside** the managed block and will survive `agent-harness wire` reruns.
- If the project adds a separate `CLAUDE.md` or `CONTRIBUTING.md`, keep `AGENTS.md` as the agent-focused orientation and reduce duplication by cross-referencing.
- Update the "Key directories" table whenever a new top-level source domain is added.
