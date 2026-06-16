# Plan 008: Hoist synonym lookup and fix ecosystem-map scan in recommend report

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- src/recommend/report.ts src/recommend/candidates.ts src/recommend/signals.ts`
> If any file changed since this plan was written, compare excerpts below
> against live code before proceeding; any mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: Plan 006 (synonym lookup precomputation in signals.ts)
- **Category**: perf
- **GitHub issue**: #299
- **Planned at**: commit `767d454`, 2026-06-16
- **Completed**: ✅ commit on `release/v2.0.0-tickets`

## Why this matters

`buildRecommendationReport` called `buildCandidateRecommendationBase` for every
catalog entry. That function was building a fresh synonym `Map` on every
invocation — `O(entries × synonyms)` — despite the synonym table being
constant for the entire report run.

Additionally `computeEcosystemMismatchPenalty` called
`REGISTRY_ECOSYSTEM_MAP.find()` (an `Array.find`) per entry, which is fine for
small catalogs but was the same scan repeated 2,921 times on real data.

Combined, a 2,000-entry test exceeded the declared 15,000ms timeout at ~81s
(5.4× regression). With catalog growth targeting 50k+ entries this would have
been catastrophic.

## What was changed

### `src/recommend/report.ts`

- Import `buildSynonymLookup` from `signals.js`
- Build `synonymLookup` once at the top of `buildRecommendationReport`
- Pass it as the new optional 5th argument to every `buildCandidateRecommendationBase` call

### `src/recommend/candidates.ts`

- Add optional `synonymLookup?: Map<string, string>` parameter to
  `buildCandidateRecommendationBase`
- Use caller-supplied lookup if provided; fall back to `buildSynonymLookup(policy)`
  for standalone / test call sites (backward compatible)
- Rename `REGISTRY_ECOSYSTEM_MAP` constant to `REGISTRY_ECOSYSTEM_ENTRIES`
  (the array) and add `REGISTRY_ECOSYSTEM_MAP` alias with documentation
  explaining why a true `Map<string, string>` cannot be used (substring-match
  semantics require ordered iteration; the rename makes the intent explicit)

## Verification

```sh
npm run build
node --test --test-name-pattern="large candidate" dist/tests/recommend-report.test.js
# Expected: ✔ recommendation reports handle large candidate sets without stalling (<15000ms)
```

## STOP conditions

- Build fails after changes
- The perf test exceeds 15,000ms in an isolated run
- Any existing recommend-report test regresses
