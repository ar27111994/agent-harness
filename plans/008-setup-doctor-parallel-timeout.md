# Plan 008 — Parallelize `setup doctor` with per-adapter timeout

## Problem

`setup doctor` iterated adapters sequentially. With 7 registered adapters and a
5 s per-command preflight timeout, a single stalling host CLI (Cursor, Zed, etc.
waiting on IPC) could block the entire loop for ~35 s wall time, making
`setup doctor` feel broken.

## Root cause

`runDoctor` iterated with a sequential `for` loop. Each adapter's
`runHostPreflight + runAdapterPreflight` call was `await`-ed before starting the
next. There was no per-adapter wall-clock guard — only a per-command spawn
timeout inside `runRuntimeCommand`.

## Fix

1. Changed the sequential `for` loop to `Promise.allSettled` over all adapters,
   running all preflights concurrently.
2. Added a `Promise.race` guard per adapter: if the adapter's combined preflight
   takes longer than `adapterTimeoutMs`, a synthetic `warning` diagnostic with
   `code: "${adapterId}-doctor-timeout"` is emitted instead of stalling.
3. Extracted `DOCTOR_ADAPTER_TIMEOUT_MS = 5_000` constant and
   `parsePositiveIntegerEnv` helper. The timeout is configurable via
   `AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS`.
4. Exported `setupInternals` with `runDoctorWithAdapters` for testability — same
   internals-export pattern used by `activateInternals` and `discoveryInternals`.

## Tests (`src/tests/setup-doctor.test.ts`)

- 6 × `parsePositiveIntegerEnv` — boundary values, zero, negative, non-numeric
- 1 × `DOCTOR_ADAPTER_TIMEOUT_MS` — verifies default is a positive integer
- 1 × concurrency — 3 no-runtime adapters complete in well under 5 s total
- 1 × timeout path — 1 ms timeout fires before any I/O; timeout diagnostic
  identified by code rather than array index (lifecycle host may emit its own
  info diagnostics first)
- 1 × `hasErrors` false when adapters produce only warnings/info
- 1 × `hasErrors` false — duplicate check confirming warning-only adapter
- 1 × results array length and `adapterId` ordering

## Outcome

12/12 tests pass. Lint clean. Build clean.
