/**
 * Semantic similarity scoring for catalog selection (#294).
 *
 * Provides:
 * - Pure math helpers: cosineSimilarity, scoreToFitLevel
 * - Entry/query text builders for embedding input
 * - Optional embedding pipeline via @xenova/transformers (graceful fallback)
 * - SemanticScorer class that wraps the optional dependency
 *
 * Design: this module is import-safe with no hard dependency on
 * @xenova/transformers. When the package is not installed, SemanticScorer
 * falls back to a no-op state and callers continue with keyword-overlap gating.
 */

import type { AssetCatalogEntry, DemandProfile } from "../../types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Valid fit-level values derived from cosine similarity scores. */
export type FitLevel = "strong" | "moderate" | "weak" | "none";

/** Cosine similarity thresholds that determine fit levels. */
export const FIT_LEVEL_THRESHOLDS = {
  /** Cosine score ≥ this → "strong" */
  strong: 0.75,
  /** Cosine score ≥ this → "moderate" */
  moderate: 0.55,
  /** Cosine score ≥ this → "weak" (kept but deprioritised) */
  weak: 0.35,
} as const;

/**
 * Weight multiplier for entries carrying ARD representativeQueries (#327).
 * When an entry has ARD-generated natural-language query text, its semantic
 * similarity score is multiplied by this factor to reflect the higher-quality
 * embedding signal compared to keyword-derived capability text.
 */
export const ARD_REPRESENTATIVE_QUERY_WEIGHT = 1.2;

// ─── Pure math helpers ───────────────────────────────────────────────────────

/**
 * Computes the cosine similarity between two equal-length float32 vectors.
 * Both vectors should be L2-normalised for meaningful results.
 * Returns a value in `[-1, 1]`; returns `0` for zero-magnitude inputs.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    /* c8 ignore next -- V8 source-map imprecision on short-circuit || */
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Maps a cosine similarity score to a human-readable fit level.
 *
 * - ≥ 0.75 → `"strong"`
 * - ≥ 0.55 → `"moderate"`
 * - ≥ 0.35 → `"weak"`
 * - < 0.35 → `"none"` (should be filtered out)
 */
export function scoreToFitLevel(score: number): FitLevel {
  if (score >= FIT_LEVEL_THRESHOLDS.strong) return "strong";
  if (score >= FIT_LEVEL_THRESHOLDS.moderate) return "moderate";
  if (score >= FIT_LEVEL_THRESHOLDS.weak) return "weak";
  return "none";
}

// ─── Text builders ───────────────────────────────────────────────────────────

/**
 * Builds the embedding input text for a catalog entry.
 * Concatenates display name and capability terms for best semantic coverage.
 */
export function buildEntryEmbeddingText(entry: AssetCatalogEntry): string {
  // ARD representativeQueries are the richest semantic signal (#327).
  // When present, they describe what the asset can do in natural language,
  // weighted at ARD_REPRESENTATIVE_QUERY_WEIGHT in the similarity score.
  if (entry.representativeQueries && entry.representativeQueries.length > 0) {
    return entry.representativeQueries.join(" ");
  }

  const parts: string[] = [];

  if (entry.displayName) {
    parts.push(entry.displayName);
  }

  if (entry.capabilities && entry.capabilities.length > 0) {
    // Capabilities are the richest semantic signal on an entry.
    parts.push(entry.capabilities.join(" "));
  }

  // Include publisher name as a weak secondary signal.
  if (entry.source.publisher) {
    parts.push(entry.source.publisher);
  }

  return parts.join(" ").trim();
}

/**
 * Builds the embedding input text for a workspace demand profile.
 * Concatenates all signal categories into a natural-language query string.
 */
export function buildDemandQueryText(
  demandProfile: DemandProfile | null,
): string {
  if (!demandProfile) {
    return "";
  }

  const signals = [
    ...demandProfile.signals.languages,
    ...demandProfile.signals.frameworks,
    ...demandProfile.signals.concerns,
    ...demandProfile.signals.tooling,
  ];

  // Strip well-known signal prefixes (npm:, pypi:, detector:) for cleaner text.
  const cleanedSignals = signals.map((s) =>
    s.replace(/^(npm|pypi|detector|framework):/u, ""),
  );

  return [...new Set(cleanedSignals)].join(" ").trim();
}

// ─── SemanticScorer ──────────────────────────────────────────────────────────

/**
 * Optional embedding-based scorer.
 *
 * When `@xenova/transformers` is installed and semantic scoring is enabled,
 * embeds the demand query and catalog entries then ranks by cosine similarity.
 *
 * When the package is absent or semantic scoring is disabled, all methods
 * return `null`/`undefined` and the caller falls back to keyword-overlap gating.
 */
export class SemanticScorer {
  /**
   * Whether the optional embedding pipeline is available.
   * Set to `true` by the constructor (embedder override path) or by a
   * successful `tryInit()` call. Set to `false` when initialisation fails.
   */
  get available(): boolean {
    return this._available;
  }

  private _available: boolean;
  private readonly minSimilarity: number;
  private embedder: ((text: string) => Promise<Float32Array>) | null = null;

  constructor(options: {
    /** Minimum cosine similarity to accept an entry. Default: 0.35 */
    minSimilarity?: number;
    /**
     * Optional embedder override for tests — skip the @xenova/transformers
     * dependency entirely.
     */
    embedderOverride?: (text: string) => Promise<Float32Array>;
  }) {
    this.minSimilarity = options.minSimilarity ?? FIT_LEVEL_THRESHOLDS.weak;
    if (options.embedderOverride) {
      this.embedder = options.embedderOverride;
      this._available = true;
    } else {
      // @xenova/transformers is an optional peer dependency — absence is expected.
      // The `available` flag tells callers whether to use semantic paths.
      this._available = false;
      // We do not attempt the dynamic import here — doing so eagerly would
      // surface errors in environments where the package is absent. Callers
      // that want to try loading the pipeline should use `tryInit()`.
    }
  }

  /**
   * Attempts to load the @xenova/transformers pipeline.
   * No-op if the package is absent — sets `available` to false.
   * Call this once before any embed operations when not using an override.
   */
  async tryInit(modelName = "Xenova/all-MiniLM-L6-v2"): Promise<void> {
    if (this.embedder) {
      return; // Already initialised (override or prior init).
    }
    try {
      /* c8 ignore start -- dynamic import only resolves when @xenova/transformers is installed */
      const { pipeline } = (await import("@xenova/transformers" as string)) as {
        pipeline: (
          task: string,
          model: string,
        ) => Promise<
          (
            text: string,
            options: { pooling: string; normalize: boolean },
          ) => Promise<{ data: Float32Array }>
        >;
      };
      const pipe = await pipeline("feature-extraction", modelName);
      this.embedder = async (text: string): Promise<Float32Array> => {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        return output.data;
      };
      this._available = true;
      /* c8 ignore stop */
    } catch {
      // Package absent or model download failed — graceful fallback.
      this._available = false;
    }
  }

  /**
   * Embeds a single text string.
   * Returns `null` when the scorer is not available.
   */
  async embed(text: string): Promise<Float32Array | null> {
    if (!this.embedder) return null;
    try {
      return await this.embedder(text);
    } catch {
      return null;
    }
  }

  /**
   * Scores a catalog entry against a pre-embedded query vector.
   * Returns `null` when the scorer is unavailable.
   * Returns a `{ score, fitLevel }` object otherwise.
   */
  async scoreEntry(
    entry: AssetCatalogEntry,
    queryVec: Float32Array,
  ): Promise<{ score: number; fitLevel: FitLevel } | null> {
    const text = buildEntryEmbeddingText(entry);
    if (!text) return null;

    const entryVec = await this.embed(text);
    if (!entryVec) return null;

    const rawScore = cosineSimilarity(queryVec, entryVec);
    // ARD entries with representativeQueries get a 1.2× weight on their
    // semantic similarity score — their embedding text is higher quality
    // than keyword-derived capability terms (#327).
    const hasRepresentativeQueries =
      entry.representativeQueries && entry.representativeQueries.length > 0;
    const score = hasRepresentativeQueries
      ? rawScore * ARD_REPRESENTATIVE_QUERY_WEIGHT
      : rawScore;
    return { score, fitLevel: scoreToFitLevel(score) };
  }

  /**
   * Filters and ranks catalog entries by semantic similarity to the demand query.
   *
   * Returns `null` when the scorer is unavailable (caller should fall back to
   * keyword-overlap gating).
   *
   * Returns `{ selected, rejected }` where:
   * - `selected` entries have `score >= minSimilarity` and include an updated
   *   `fit.fitLevel` field.
   * - `rejected` entries have `score < minSimilarity`.
   */
  async filterAndRank(
    catalogEntries: AssetCatalogEntry[],
    demandProfile: DemandProfile | null,
  ): Promise<{
    selected: AssetCatalogEntry[];
    rejected: AssetCatalogEntry[];
  } | null> {
    if (!this.available || !this.embedder) return null;

    const queryText = buildDemandQueryText(demandProfile);
    if (!queryText) {
      // No demand signals → pass all entries through unchanged.
      return { selected: catalogEntries, rejected: [] };
    }

    const queryVec = await this.embed(queryText);
    if (!queryVec) return null;

    const selected: Array<{ entry: AssetCatalogEntry; score: number }> = [];
    const rejected: AssetCatalogEntry[] = [];

    for (const entry of catalogEntries) {
      const result = await this.scoreEntry(entry, queryVec);
      if (!result) {
        // Cannot score this entry — keep it (conservative) with score=0.
        selected.push({ entry, score: 0 });
        continue;
      }

      if (result.score >= this.minSimilarity) {
        selected.push({
          entry: {
            ...entry,
            fit: { ...entry.fit, fitLevel: result.fitLevel },
          },
          score: result.score,
        });
      } else {
        rejected.push({
          ...entry,
          fit: { ...entry.fit, fitLevel: "none" },
        });
      }
    }

    // Sort selected entries: primary key = fitLevel bucket (highest first),
    // secondary key = cosine similarity score (highest first) within each bucket.
    selected.sort((a, b) => {
      const fitOrder: Record<string, number> = {
        strong: 3,
        moderate: 2,
        weak: 1,
        none: 0,
      };
      const bucketDiff =
        /* c8 ignore next 2 -- fitLevel is a required FitLevel union; ?? branches are unreachable with valid typed values */
        (fitOrder[b.entry.fit.fitLevel ?? "none"] ?? 0) -
        (fitOrder[a.entry.fit.fitLevel ?? "none"] ?? 0);
      /* c8 ignore start -- both ternary arms are covered by the sort tests;
         the branch miss is a v8 source-map artefact: the ??-ignore block above
         shifts the branch attribution to this ternary line in the source map */
      return bucketDiff !== 0 ? bucketDiff : b.score - a.score;
      /* c8 ignore stop */
    });

    return { selected: selected.map((s) => s.entry), rejected };
  }

  /** Minimum similarity threshold used by this scorer. */
  get threshold(): number {
    return this.minSimilarity;
  }
}

/** Exposes narrow semantic-scoring internals for focused tests. */
export const semanticScoringInternals = {
  FIT_LEVEL_THRESHOLDS,
  scoreToFitLevel,
  cosineSimilarity,
  buildEntryEmbeddingText,
  buildDemandQueryText,
};
