# Plan 006: Precompute synonym lookup map to fix O(tokens × synonyms) hot path in recommendation scoring

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- src/recommend/signals.ts src/recommend/candidates.ts`
> If either file changed since this plan was written, compare excerpts below
> against live code before proceeding; any mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ca36be9`, 2026-06-15

## Why this matters

`buildSearchTerms` is called for every catalog entry during recommendation scoring. Inside it, `canonicalizePhrase` is called for every phrase/token — and `canonicalizePhrase` does a linear scan over `Object.entries(policy.synonyms)` on each invocation.

For a catalog with 6,000+ entries and a policy with N synonym rules, scoring cost is proportional to `entries × tokens_per_entry × synonyms`. The benchmark (#299) already found `recommend report` takes 81s on a 2,000-entry test; synonym canonicalization is a significant fraction of that. With catalog growth (#289 targets 50k+ entries), this becomes unacceptable.

The fix is to build a flat alias→canonical map once per policy (not per call) and use O(1) map lookups in `canonicalizePhrase`.

## Current state

File: `src/recommend/signals.ts`

```typescript
// line 418 — buildSearchTerms iterates over values and calls canonicalizePhrase each time
export function buildSearchTerms(
  values: string[],
  policy: RecommendationPolicy,
): Set<string> {
  const searchTerms = new Set<string>();
  for (const value of values) {
    const normalizedPhrase = canonicalizePhrase(value, policy);  // ← called per-value
    if (normalizedPhrase) {
      searchTerms.add(normalizedPhrase);
    }
    // ... more per-token calls below
```

`canonicalizePhrase` at some point does (approximately):

```typescript
for (const [alias, canonical] of Object.entries(policy.synonyms)) {
  if (normalizedInput.includes(alias)) {
    return canonical;
  }
}
```

(Confirm exact shape by reading the function body before writing the fix.)

File: `src/recommend/candidates.ts`

```typescript
// line 106 — buildCandidateRecommendationBase computes searchTerms
// line 376 — buildGenericToolingTerms recomputes overlapping terms
```

These two functions independently generate search terms from the same policy, paying the synonym scan cost twice per candidate.

The repo convention for per-policy precomputation: check `src/recommend/policy.ts` — it likely has a similar pattern for other policy-derived structures. Match whatever memoization/context object pattern is used there.

## Commands you will need

| Purpose   | Command                  | Expected on success            |
| --------- | ------------------------ | ------------------------------ |
| Build     | `npm run build`          | exit 0                         |
| Typecheck | `npm run typecheck`      | exit 0, no errors              |
| Tests     | `npm test`               | all pass                       |
| Benchmark | `npm run benchmark:scan` | completes; note time vs before |
| Lint      | `npm run lint`           | exit 0                         |

## Scope

**In scope**:

- `src/recommend/signals.ts` — `buildSearchTerms` and `canonicalizePhrase`
- `src/recommend/candidates.ts` — term generation calls that duplicate the synonym scan

**Out of scope** (do NOT touch):

- `src/recommend/policy.ts` — do not change policy shape
- Any other file unless `canonicalizePhrase` is defined outside `signals.ts` (check first)

## Git workflow

- Branch: `perf/006-precompute-synonym-map`
- Commit message: `perf(recommend): precompute synonym alias→canonical map per policy`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Read `canonicalizePhrase` and confirm the synonym traversal pattern

```bash
grep -n "canonicalizePhrase\|Object.entries.*synonym\|synonym" src/recommend/signals.ts | head -20
```

Read the full function body. Confirm it does a linear scan over `policy.synonyms`. If it uses a different structure, adapt the plan to match.

**Verify**: you can see the loop in the function body.

### Step 2: Add a `buildSynonymLookup` function in `signals.ts`

Add this function near `canonicalizePhrase`:

```typescript
/**
 * Builds a flat alias→canonical lookup from the policy synonym map.
 * Call once per policy context, then pass to canonicalizePhrase.
 */
export function buildSynonymLookup(
  policy: RecommendationPolicy,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(policy.synonyms)) {
    for (const alias of Array.isArray(aliases) ? aliases : [aliases]) {
      lookup.set(alias.toLowerCase(), canonical.toLowerCase());
    }
  }
  return lookup;
}
```

Adjust the shape to match the actual `policy.synonyms` type — read the type definition before writing this.

**Verify**: `npm run typecheck` → exit 0

### Step 3: Update `canonicalizePhrase` to accept an optional precomputed lookup

Change the signature to:

```typescript
export function canonicalizePhrase(
  value: string,
  policy: RecommendationPolicy,
  synonymLookup?: Map<string, string>,  // precomputed; falls back to building on demand
): string | null {
```

Inside: if `synonymLookup` is provided, use `synonymLookup.get(normalized)` instead of the linear scan. If not provided, build one on demand (backward-compatible fallback).

**Verify**: `npm run typecheck` → exit 0

### Step 4: Update `buildSearchTerms` to accept and thread a precomputed lookup

Change signature to:

```typescript
export function buildSearchTerms(
  values: string[],
  policy: RecommendationPolicy,
  synonymLookup?: Map<string, string>,
): Set<string> {
```

Pass `synonymLookup` to every `canonicalizePhrase` call inside.

**Verify**: `npm run typecheck` → exit 0

### Step 5: Build the lookup once per recommendation run in `candidates.ts`

In `src/recommend/candidates.ts`, find where `buildSearchTerms` is called for a batch of candidates (the scoring hot path). Build `synonymLookup` once before the loop:

```typescript
const synonymLookup = buildSynonymLookup(policy);
// ... then pass synonymLookup to each buildSearchTerms call
```

Import `buildSynonymLookup` from `signals.ts`.

**Verify**: `npm run typecheck` → exit 0

### Step 6: Build and test

**Verify**: `npm run build` → exit 0
**Verify**: `npm test` → all pass

### Step 7: Benchmark

```bash
npm run benchmark:scan
```

Note the time. It should be materially lower than before (the baseline was 81s on a 2,000-entry test). If not, check that the hot path is actually calling the version with the precomputed map.

### Step 8: Lint

**Verify**: `npm run lint` → exit 0

## Test plan

Add tests to `src/tests/recommend-signals.test.ts` (model after existing tests there):

1. **`buildSynonymLookup` produces correct map**: given a policy with known synonyms, assert the lookup map contains the expected alias→canonical pairs
2. **`canonicalizePhrase` with precomputed lookup matches results without it**: for a sample policy and input, `canonicalizePhrase(v, policy)` equals `canonicalizePhrase(v, policy, buildSynonymLookup(policy))`
3. **Performance (optional)**: time `buildSearchTerms` over 1,000 values with a 100-entry synonym map; assert it completes in <500ms

**Verify**: `npm test` → new tests pass

## Done criteria

- [ ] `buildSynonymLookup` function exists in `src/recommend/signals.ts`
- [ ] `canonicalizePhrase` uses the precomputed map when provided
- [ ] `buildSearchTerms` accepts and threads `synonymLookup`
- [ ] The recommendation scoring hot path in `candidates.ts` builds the lookup once per run
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, all pass
- [ ] `npm run benchmark:scan` completes faster than the 81s baseline (measure and note in commit)
- [ ] `npm run lint` exits 0
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report if:

- `policy.synonyms` has a type shape incompatible with the proposed `buildSynonymLookup` — report the actual type and stop.
- The hot path is not in `candidates.ts` — report where `buildSearchTerms` is called in bulk and stop.
- `npm test` fails with synonym-related test failures after the change — likely a lookup-key normalization mismatch; report.

## Maintenance notes

- If `RecommendationPolicy` is ever versioned or replaced, the synonym lookup type must be updated to match.
- The `synonymLookup` parameter is optional for backward compatibility. Future cleanup: make it required in all bulk-call sites and remove the on-demand fallback.
- This is the first of several scoring performance improvements; #294 (semantic scoring) will also benefit from the precomputed map infrastructure introduced here.
