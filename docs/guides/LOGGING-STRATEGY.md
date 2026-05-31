# Logging Strategy

This document records the current logging decision for `agent-harness`.

## Decision

For the current shape of the project, `agent-harness` should use a **lightweight internal output/logging abstraction** instead of adopting a full structured logging library.

Today that means:

- human-facing CLI help/output remains simple and intentional
- `console.warn` / `console.error` remain acceptable for warnings and failures
- shared output formatting should move behind small internal helpers when drift starts appearing
- a full logging-library migration is deferred until the project has concrete service-like needs

## Why this is the right fit right now

`agent-harness` is primarily a:

- local CLI
- build/test/release tool
- workspace lifecycle orchestrator
- reproducible artifact generator

It is **not** currently a long-running daemon, multi-tenant service, or telemetry pipeline.

That matters because the main value from a library such as Pino usually shows up when you need things like:

- structured log ingestion
- persistent log shipping
- high-volume request logging
- centralized observability backends
- log correlation across service boundaries
- production runtime telemetry at scale

Those needs are not the dominant shape of this repo today.

## What we do need today

The repo does still need consistency. The practical needs right now are:

- predictable CLI help formatting
- bounded, intentional human-readable progress output
- clear separation between normal output vs warnings/errors
- lint guardrails so logging/output patterns do not drift silently

That is why the project now favors small internal helpers such as `src/lib/cli-output.ts` and lint rules that keep console usage explicit.

## Current policy

### 1. Prefer internal helpers for repeated user-facing output

If multiple command groups render the same kind of output, extract a helper instead of hand-formatting the same layout repeatedly.

Examples:

- command help blocks
- repeated summary/report formatting
- shared warning/error presentation rules

### 2. Keep stdout human-first for the CLI surface

Most current output is for humans running commands locally. That means:

- readable text is the default
- command help should stay stable and aligned
- warnings should remain sparse and actionable
- errors should explain the blocking failure directly

### 3. Use lint rules to make console usage intentional

`eslint.config.mjs` should remain the guardrail for:

- where `console.log` is allowed
- where only `warn` / `error` are allowed
- which hotspot modules must avoid threshold drift via extracted constants

### 4. Do not add a logging dependency just for aesthetics

A library is not justified merely because the codebase has grown.

Adopt one only when it solves a concrete operational problem that the current internal approach cannot solve cleanly.

## When to revisit this decision

Revisit a real logging library if one or more of these become true:

- `agent-harness` gains a daemon/server mode
- the project starts emitting machine-consumed structured event streams
- CI/release diagnostics need stable JSON logs across many steps
- there is a clear requirement for log correlation, redaction policy, or transport plugins
- runtime telemetry needs outweigh the simplicity of the current CLI-first approach

If that happens, reevaluate with a short migration design before changing implementation.

## If a library is needed later

If the project eventually crosses that threshold, prefer evaluating **Pino first** because it is:

- lightweight
- well understood in Node.js ecosystems
- compatible with structured JSON logging
- easier to justify than heavier general-purpose logging stacks

But that remains a future option, not a present requirement.

## Migration boundary if the decision changes

If a real logging library is adopted later, keep the migration scoped:

1. define which commands/runtime paths truly need structured logs
2. preserve simple human-facing CLI help and command summaries where plain text is better
3. migrate shared helpers first, not every file ad hoc
4. document stdout/stderr expectations before changing user-visible output contracts

## Summary

Current stance:

- **No full logging library yet**
- **Yes to small internal output/logging helpers**
- **Yes to lint guardrails for console usage and threshold drift**
- **Reevaluate only when the repo becomes observability-heavy enough to justify it**
