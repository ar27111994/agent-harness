import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
} from "../files.js";
import {
  assertAllowedPublicHttpUrlWithDns,
  fetchJsonWithGuards,
} from "../lib/http.js";
import {
  assertAssetCatalogEntry,
  assertDemandProfile,
  assertRecommendationAiReviewArtifact,
  assertRecommendationAiReviewInput,
} from "../manifest-validation.js";
import { buildHostSummary, buildSuggestedBundle } from "./summary.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  RecommendationAiReviewArtifact,
  RecommendationAiReviewCandidate,
  RecommendationAiReviewConfidence,
  RecommendationAiReviewHostResult,
  RecommendationAiReviewInput,
  RecommendationEntry,
  RecommendationHostSummary,
  RecommendationPolicy,
  RecommendationReport,
  RecommendationSuggestedBundle,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";

const INPUT_PATH = ["recommend", "output", "ai-review-input.json"] as const;
const OUTPUT_PATH = ["recommend", "output", "ai-review.json"] as const;
const DEFAULT_REVIEW_LIMIT = 24;
const MAX_REVIEW_LIMIT = 80;
const MIN_RERANK_DELTA = -30;
const MAX_RERANK_DELTA = 30;
const MAX_AI_REVIEW_WARNING_COUNT = 20;
const MAX_AI_REVIEW_REASON_LENGTH = 400;

interface RecommendationAiReviewOptions {
  host?: RecommendationHost;
  reviewLimit?: number;
}

interface RecommendationAiReviewRunResult {
  input: RecommendationAiReviewInput;
  artifact: RecommendationAiReviewArtifact;
  report: RecommendationReport;
}

/**
 * Loads a previously written AI review input artifact when present.
 */
export async function readRecommendationAiReviewInput(
  projectRoot: string,
): Promise<RecommendationAiReviewInput | null> {
  return readJsonFileOrNull<RecommendationAiReviewInput>(
    join(projectRoot, ...INPUT_PATH),
    assertRecommendationAiReviewInput,
  );
}

/**
 * Loads a previously written AI review artifact when present.
 */
export async function readRecommendationAiReviewArtifact(
  projectRoot: string,
): Promise<RecommendationAiReviewArtifact | null> {
  return readJsonFileOrNull<RecommendationAiReviewArtifact>(
    join(projectRoot, ...OUTPUT_PATH),
    assertRecommendationAiReviewArtifact,
  );
}

/**
 * Builds a bounded AI review input bundle from the current recommendation report.
 */
export function buildRecommendationAiReviewInput(
  report: RecommendationReport,
  demandProfile: DemandProfile | null,
  options: RecommendationAiReviewOptions = {},
): RecommendationAiReviewInput {
  const reviewLimit = clampReviewLimit(options.reviewLimit);
  const reviewedHosts = options.host
    ? [options.host]
    : (Object.keys(report.topByHost) as RecommendationHost[]);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: report.policyVersion,
    reviewLimit,
    demandSignals: demandProfile?.signals ?? null,
    reviewedHosts,
    hosts: reviewedHosts.map((host) => ({
      host,
      candidates: (report.topByHost[host] ?? [])
        .slice(0, reviewLimit)
        .map((entry) => toAiReviewCandidate(entry)),
    })),
  };
}

/**
 * Runs the bounded AI review stage and optionally applies its adjustments to the report.
 */
export async function runRecommendationAiReview(options: {
  projectRoot: string;
  policy: RecommendationPolicy;
  report: RecommendationReport;
  host?: RecommendationHost;
  reviewLimit?: number;
  apply: boolean;
}): Promise<RecommendationAiReviewRunResult> {
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(options.projectRoot, "discover", "output", "demand-profile.json"),
    assertDemandProfile,
  );
  const input = buildRecommendationAiReviewInput(
    options.report,
    demandProfile,
    {
      host: options.host,
      reviewLimit: options.reviewLimit,
    },
  );
  await writeJsonFile(join(options.projectRoot, ...INPUT_PATH), input);

  const config = getRuntimeConfig().aiEnrichment;
  if (!config.url || !config.apiKey) {
    const disabledArtifact: RecommendationAiReviewArtifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      enabled: false,
      status: "disabled",
      model: config.model,
      reviewedHosts: input.reviewedHosts,
      hostReviews: input.reviewedHosts.map((host) => emptyHostReview(host)),
      warnings: [
        "AI review is disabled. Set AGENT_HARNESS_AI_ENRICHMENT_URL and AGENT_HARNESS_AI_ENRICHMENT_API_KEY to enable bounded recommendation review.",
      ],
    };
    await writeJsonFile(
      join(options.projectRoot, ...OUTPUT_PATH),
      disabledArtifact,
    );
    return {
      input,
      artifact: disabledArtifact,
      report: options.report,
    };
  }

  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(options.projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );

  try {
    const url = await assertAllowedPublicHttpUrlWithDns(
      config.url,
      config.allowedOrigins,
    );
    const response = await fetchJsonWithGuards(url.toString(), {
      allowedOrigins: config.allowedOrigins,
      body: JSON.stringify({
        model: config.model,
        messages: buildAiReviewMessages(input, selectedEntries),
      }),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      maxBytes: config.responseMaxBytes,
      method: "POST",
      timeoutMs: config.requestTimeoutMs,
    });

    if (response === null) {
      throw new Error(
        "AI review request returned an empty or invalid JSON response.",
      );
    }

    const artifact = sanitizeAiReviewArtifact(
      parseAiReviewResponse(response),
      input,
      url.origin,
      config.model,
    );
    await writeJsonFile(join(options.projectRoot, ...OUTPUT_PATH), artifact);

    return {
      input,
      artifact,
      report: options.apply
        ? applyAiReviewToReport(options.report, artifact, options.policy)
        : options.report,
    };
  } catch (error) {
    const failedArtifact: RecommendationAiReviewArtifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      enabled: true,
      status: "failed",
      model: config.model,
      reviewedHosts: input.reviewedHosts,
      hostReviews: input.reviewedHosts.map((host) => emptyHostReview(host)),
      error: error instanceof Error ? error.message : String(error),
    };
    await writeJsonFile(
      join(options.projectRoot, ...OUTPUT_PATH),
      failedArtifact,
    );
    return {
      input,
      artifact: failedArtifact,
      report: options.report,
    };
  }
}

/**
 * Applies a validated AI review artifact to a deterministic recommendation report.
 */
export function applyAiReviewToReport(
  report: RecommendationReport,
  artifact: RecommendationAiReviewArtifact,
  policy: RecommendationPolicy,
): RecommendationReport {
  if (artifact.status !== "completed") {
    return report;
  }

  const hostReviewByHost = new Map(
    artifact.hostReviews.map((review) => [review.host, review]),
  );
  const nextTopByHost = Object.fromEntries(
    Object.entries(report.topByHost).map(([host, entries]) => {
      const hostReview = hostReviewByHost.get(host);
      return [
        host,
        hostReview
          ? applyHostAiReview(
              host as RecommendationHost,
              entries,
              hostReview,
              policy,
            )
          : entries,
      ];
    }),
  ) as Record<string, RecommendationEntry[]>;

  const nextHostSummaries = Object.fromEntries(
    Object.entries(nextTopByHost).map(([host, entries]) => [
      host,
      buildHostSummary(host as RecommendationHost, entries, policy),
    ]),
  ) as Record<string, RecommendationHostSummary>;
  const nextSuggestedBundles = Object.entries(nextTopByHost).map(
    ([host, entries]) =>
      buildSuggestedBundle(host as RecommendationHost, entries, policy),
  ) as RecommendationSuggestedBundle[];

  return {
    ...report,
    generatedAt: new Date().toISOString(),
    topByHost: nextTopByHost,
    hostSummaries: nextHostSummaries,
    suggestedBundles: nextSuggestedBundles,
  };
}

function buildAiReviewMessages(
  input: RecommendationAiReviewInput,
  selectedEntries: AssetCatalogEntry[],
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You are reviewing a bounded deterministic recommendation shortlist for agent-harness.",
        "Return JSON only.",
        "Do not invent assets outside the provided candidate asset ids.",
        "You may keep assets, mark them questionable, suppress weak false positives, and propose bounded rerank deltas between -30 and 30.",
        "Prioritize removing generic false positives, package self-echo, and recovering missing design-tool recall when the shortlist already contains relevant assets.",
        "Schema:",
        JSON.stringify({
          hostReviews: [
            {
              host: "cursor",
              acceptedAssetIds: ["asset-id"],
              questionable: [
                {
                  assetId: "asset-id",
                  reason: "brief rationale",
                  confidence: "medium",
                },
              ],
              suppressedAssetIds: ["asset-id"],
              rerank: [
                {
                  assetId: "asset-id",
                  delta: 12,
                  reason: "brief rationale",
                  confidence: "medium",
                },
              ],
            },
          ],
          warnings: ["optional warning"],
        }),
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        input,
        selectedCatalogExcerpt: selectedEntries.slice(0, 80).map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          assetKind: entry.assetKind,
          sourceId: entry.source.sourceId,
          sourceKind: entry.source.sourceKind,
          authorityTier: entry.source.authorityTier,
          manifestEntry: entry.install.manifestEntry,
          capabilities: entry.capabilities.slice(0, 16),
          hosts: entry.hosts,
        })),
      }),
    },
  ];
}

function parseAiReviewResponse(response: unknown): unknown {
  const responseRecord = asJsonObject(response);
  if (!responseRecord) {
    return {};
  }

  if (Array.isArray(responseRecord.hostReviews)) {
    return responseRecord;
  }

  const choicesValue = asUnknownArray(responseRecord.choices);
  if (!choicesValue) {
    return {};
  }

  const firstChoice = asJsonObject(choicesValue[0]);
  const message = asJsonObject(firstChoice?.message);
  const content = extractAiReviewMessageContent(message);

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return {};
  }
}

function sanitizeAiReviewArtifact(
  response: unknown,
  input: RecommendationAiReviewInput,
  provider: string,
  model: string,
): RecommendationAiReviewArtifact {
  const inputAssetIdsByHost = new Map(
    input.hosts.map((hostInput) => [
      hostInput.host,
      new Set(hostInput.candidates.map((candidate) => candidate.assetId)),
    ]),
  );
  const responseRecord = asJsonObject(response) ?? {};
  const hostReviewsRaw = asUnknownArray(responseRecord.hostReviews) ?? [];
  const warnings = sanitizeWarnings(responseRecord.warnings);
  const hostReviews = input.reviewedHosts.map((host) =>
    sanitizeHostReview(
      host,
      findHostReviewRecord(hostReviewsRaw, host),
      inputAssetIdsByHost.get(host) ?? new Set<string>(),
    ),
  );

  const artifact: RecommendationAiReviewArtifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled: true,
    status: "completed",
    provider,
    model,
    reviewedHosts: input.reviewedHosts,
    hostReviews,
    warnings,
  };
  assertRecommendationAiReviewArtifact(
    artifact,
    "recommend/output/ai-review.json",
  );
  return artifact;
}

function sanitizeHostReview(
  host: RecommendationHost,
  rawHostReview: Record<string, unknown> | null | undefined,
  allowedAssetIds: Set<string>,
): RecommendationAiReviewHostResult {
  if (!rawHostReview) {
    return emptyHostReview(host);
  }

  return {
    host,
    acceptedAssetIds: sanitizeAssetIdArray(
      rawHostReview.acceptedAssetIds,
      allowedAssetIds,
    ),
    questionable: sanitizeNotes(rawHostReview.questionable, allowedAssetIds),
    suppressedAssetIds: sanitizeAssetIdArray(
      rawHostReview.suppressedAssetIds,
      allowedAssetIds,
    ),
    rerank: sanitizeReranks(rawHostReview.rerank, allowedAssetIds),
  };
}

function findHostReviewRecord(
  hostReviewsRaw: unknown[],
  host: RecommendationHost,
): Record<string, unknown> | null {
  for (const entry of hostReviewsRaw) {
    const hostReviewRecord = asJsonObject(entry);
    if (hostReviewRecord?.host === host) {
      return hostReviewRecord;
    }
  }

  return null;
}

function sanitizeAssetIdArray(
  value: unknown,
  allowedAssetIds: Set<string>,
): string[] {
  const entries = asUnknownArray(value);
  if (!entries) {
    return [];
  }

  const assetIds: string[] = [];
  const seenAssetIds = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry: unknown = entries[index];
    if (typeof entry !== "string") {
      continue;
    }
    if (!allowedAssetIds.has(entry) || seenAssetIds.has(entry)) {
      continue;
    }

    seenAssetIds.add(entry);
    assetIds.push(entry);
  }

  return assetIds;
}

function sanitizeNotes(
  value: unknown,
  allowedAssetIds: Set<string>,
): RecommendationAiReviewHostResult["questionable"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitizedNotes = new Map<
    string,
    RecommendationAiReviewHostResult["questionable"][number]
  >();

  for (const entry of value) {
    const note = asJsonObject(entry);
    if (!note || typeof note.assetId !== "string") {
      continue;
    }
    if (
      !allowedAssetIds.has(note.assetId) ||
      sanitizedNotes.has(note.assetId)
    ) {
      continue;
    }

    sanitizedNotes.set(note.assetId, {
      assetId: note.assetId,
      reason: sanitizeReason(
        note.reason,
        "AI review flagged this asset as questionable.",
      ),
      confidence: sanitizeConfidence(note.confidence),
    });
  }

  return [...sanitizedNotes.values()];
}

function sanitizeReranks(
  value: unknown,
  allowedAssetIds: Set<string>,
): RecommendationAiReviewHostResult["rerank"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitizedReranks = new Map<
    string,
    RecommendationAiReviewHostResult["rerank"][number]
  >();

  for (const entry of value) {
    const rerank = asJsonObject(entry);
    if (!rerank || typeof rerank.assetId !== "string") {
      continue;
    }
    if (
      !allowedAssetIds.has(rerank.assetId) ||
      sanitizedReranks.has(rerank.assetId)
    ) {
      continue;
    }

    sanitizedReranks.set(rerank.assetId, {
      assetId: rerank.assetId,
      delta: clampNumber(rerank.delta, MIN_RERANK_DELTA, MAX_RERANK_DELTA),
      reason: sanitizeReason(rerank.reason, "AI review reranked this asset."),
      confidence: sanitizeConfidence(rerank.confidence),
    });
  }

  return [...sanitizedReranks.values()];
}

function sanitizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const warnings: string[] = [];
  const seenWarnings = new Set<string>();

  for (const entry of value) {
    const warning = sanitizeReason(entry, "");
    if (!warning || seenWarnings.has(warning)) {
      continue;
    }

    seenWarnings.add(warning);
    warnings.push(warning);
    if (warnings.length >= MAX_AI_REVIEW_WARNING_COUNT) {
      break;
    }
  }

  return warnings;
}

function sanitizeReason(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    return fallback;
  }

  return normalized.slice(0, MAX_AI_REVIEW_REASON_LENGTH);
}

function sanitizeConfidence(value: unknown): RecommendationAiReviewConfidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function applyHostAiReview(
  host: RecommendationHost,
  entries: RecommendationEntry[],
  hostReview: RecommendationAiReviewHostResult,
  policy: RecommendationPolicy,
): RecommendationEntry[] {
  const rerankDeltaByAssetId = new Map(
    hostReview.rerank.map((entry) => [entry.assetId, entry.delta]),
  );
  const questionableAssetIds = new Set(
    hostReview.questionable.map((entry) => entry.assetId),
  );
  const suppressedAssetIds = new Set(hostReview.suppressedAssetIds);

  const adjustedEntries = entries
    .filter((entry) => !suppressedAssetIds.has(entry.assetId))
    .map((entry, index) => {
      const rerankDelta = rerankDeltaByAssetId.get(entry.assetId) ?? 0;
      const nextReasons = [...entry.reasons];
      if (rerankDelta !== 0) {
        nextReasons.push(
          `ai-review:rerank:${rerankDelta > 0 ? "+" : ""}${rerankDelta}`,
        );
      }
      if (questionableAssetIds.has(entry.assetId)) {
        nextReasons.push("ai-review:questionable");
      }
      return {
        ...entry,
        score: entry.score + rerankDelta,
        reasons: nextReasons,
        scoreBreakdown: {
          ...entry.scoreBreakdown,
          total: entry.scoreBreakdown.total + rerankDelta,
        },
        rank: index + 1,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.assetId.localeCompare(right.assetId),
    )
    .slice(0, policy.hosts[host].recommendationLimit)
    .map((entry, index) => ({
      ...entry,
      host,
      rank: index + 1,
    }));

  return adjustedEntries;
}

function toAiReviewCandidate(
  entry: RecommendationEntry,
): RecommendationAiReviewCandidate {
  return {
    assetId: entry.assetId,
    host: entry.host,
    rank: entry.rank,
    score: entry.score,
    assetKind: entry.assetKind,
    sourceFamily: entry.sourceFamily,
    availableLocally: entry.availableLocally,
    recommendationBasis: entry.recommendationBasis,
    duplicateGroup: entry.duplicateGroup,
    coverageTags: entry.coverageTags,
    taskModes: entry.taskModes,
    matchedSignals: entry.matchedSignals,
    reasons: entry.reasons,
    scoreBreakdown: entry.scoreBreakdown,
  };
}

function emptyHostReview(
  host: RecommendationHost,
): RecommendationAiReviewHostResult {
  return {
    host,
    acceptedAssetIds: [],
    questionable: [],
    suppressedAssetIds: [],
    rerank: [],
  };
}

function clampReviewLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_REVIEW_LIMIT;
  }

  return Math.max(1, Math.min(MAX_REVIEW_LIMIT, Math.round(value)));
}

function clampNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function extractAiReviewMessageContent(
  message: Record<string, unknown> | null,
): string {
  if (!message) {
    return "{}";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const textParts = message.content
      .map((block) => asJsonObject(block))
      .filter((block): block is Record<string, unknown> => block !== null)
      .flatMap((block) => {
        if (typeof block.text === "string") {
          return [block.text];
        }
        if (typeof block.output_text === "string") {
          return [block.output_text];
        }
        return [];
      });

    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  if (typeof message.output_text === "string") {
    return message.output_text;
  }

  return "{}";
}

function asUnknownArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? Array.from<unknown>(value) : null;
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
