# Semantic Scoring Guide

> **Status:** opt-in (default `false`). Enable with `AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING=true`.

## Overview

By default, `agent-harness discover select` uses a **keyword-overlap gate** to filter
catalog entries by demand relevance. While fast and dependency-free, keyword matching
has ~30–40% recall on semantically equivalent but lexically distinct text pairs —
GitLens, Prettier, and ESLint are all rejected if the demand profile doesn't contain
their exact names.

**Semantic scoring** replaces the binary accept/reject gate with cosine-similarity
ranking using a lightweight local embedding model. This resolves the vocabulary
mismatch problem and also populates `fit.fitLevel` on each selected entry.

## How It Works

1. **Query embedding**: The workspace demand profile (languages, frameworks, concerns,
   tooling) is converted to a single query text and embedded into a 384-dim vector.

2. **Entry embedding**: Each catalog entry's display name + capabilities are
   embedded into the same vector space.

3. **Cosine similarity**: Each entry is scored against the query vector. Entries
   scoring below the configured threshold are rejected; the rest are ranked by score.

4. **`fit.fitLevel` population**: The cosine score maps to a human-readable level:

   | Score  | `fitLevel`                     |
   | ------ | ------------------------------ |
   | ≥ 0.75 | `"strong"`                     |
   | ≥ 0.55 | `"moderate"`                   |
   | ≥ 0.35 | `"weak"` (kept, deprioritised) |
   | < 0.35 | `"none"` (filtered out)        |

## Requirements

The embedding pipeline requires `@xenova/transformers`:

```bash
npm install @xenova/transformers
```

The default model (`Xenova/all-MiniLM-L6-v2`, ~22 MB) is downloaded on first use
and cached in `~/.cache/xenova/`. No GPU, Python, or system dependencies are needed.

## Configuration

| Environment variable                       | Default | Description                                      |
| ------------------------------------------ | ------- | ------------------------------------------------ |
| `AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING` | `false` | Set `true` to enable semantic scoring            |
| `AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY`   | `0.35`  | Minimum cosine similarity to pass the gate (0–1) |

### Example

```bash
# Enable semantic scoring with a higher threshold (stronger relevance bar):
AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING=true \
AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY=0.45 \
  agent-harness discover select
```

## Graceful Fallback

When `AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING=true` but `@xenova/transformers` is
not installed (or model download fails), `agent-harness` automatically falls back to
the keyword-overlap gate and prints a warning. No error is thrown and no data is lost.

## Source Diversity

Semantic scoring does **not** bypass the per-source-family cap
(`AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE`). Source diversity caps are applied
**after** similarity ranking, so high-relevance entries from the top sources are
preserved while long-tail dominance is still prevented.

## Performance

| Catalog size            | Embedding pass (CPU, 4-core) | Notes                              |
| ----------------------- | ---------------------------- | ---------------------------------- |
| 10,000 entries          | ~3–5 min                     | First run; model download included |
| 10,000 entries          | ~2 min                       | Subsequent runs (model cached)     |
| 100,000 entries         | ~20 min                      | Full-index scale                   |
| Selection (cosine only) | < 1 s                        | After embeddings are pre-computed  |

For large catalogs, run the embedding pass as part of `discover index` (scheduled)
rather than inline in `discover select`.

## Internals

The implementation lives in:

- `src/domains/discovery/semantic-scoring.ts` — pure math (`cosineSimilarity`,
  `scoreToFitLevel`), text builders, and `SemanticScorer` class
- `src/types/catalog.ts` — `AssetFit.fitLevel` field
- `src/config/runtime.ts` — `discovery.semanticScoringEnabled` and
  `discovery.semanticScoringMinSimilarity` config keys
