import { join } from "node:path";

import { getRuntimeConfig } from "../../config/runtime.js";
import {
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
} from "../../files.js";
import {
  assertAllowedPublicHttpUrlWithDns,
  fetchJsonWithGuards,
} from "../../lib/http.js";
import {
  assertAssetCatalogEntry,
  assertDemandProfile,
} from "../../manifest-validation.js";
import type { AssetCatalogEntry, DemandProfile } from "../../types.js";

interface AiEnrichmentReport {
  schemaVersion: 1;
  generatedAt: string;
  enabled: boolean;
  provider?: string;
  model?: string;
  status: "disabled" | "completed" | "failed";
  summary?: string;
  recommendations?: string[];
  error?: string;
}

const OUTPUT_PATH = ["discover", "output", "ai-enrichment.json"] as const;

/**
 * Writes ai enrichment report to project state.
 */
export async function writeAiEnrichmentReport(
  projectRoot: string,
): Promise<void> {
  const config = getRuntimeConfig().aiEnrichment;
  const endpointUrl = config.url;
  const apiKey = config.apiKey;
  const model = config.model;
  const outputPath = join(projectRoot, ...OUTPUT_PATH);

  if (!endpointUrl || !apiKey) {
    await writeJsonFile(outputPath, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      enabled: false,
      status: "disabled",
      summary:
        "AI-assisted enrichment is disabled. Set AGENT_HARNESS_AI_ENRICHMENT_URL and AGENT_HARNESS_AI_ENRICHMENT_API_KEY to enable it.",
    } satisfies AiEnrichmentReport);
    console.log(`AI enrichment disabled; report written to ${outputPath}`);
    return;
  }

  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    assertDemandProfile,
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );

  try {
    const url = await assertAllowedPublicHttpUrlWithDns(
      endpointUrl,
      config.allowedOrigins,
    );
    const response = await fetchJsonWithGuards(url.toString(), {
      allowedOrigins: config.allowedOrigins,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Summarize agent-harness discovery evidence. Return concise JSON with summary and recommendations array.",
          },
          {
            role: "user",
            content: JSON.stringify({
              demandSignals: demandProfile?.signals ?? null,
              selectedAssets: selectedEntries.slice(0, 50).map((entry) => ({
                id: entry.id,
                kind: entry.assetKind,
                hosts: entry.hosts,
                capabilities: entry.capabilities,
                source: entry.source.sourceId,
              })),
            }),
          },
        ],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      maxBytes: config.responseMaxBytes,
      method: "POST",
      timeoutMs: config.requestTimeoutMs,
    });
    const content = extractCompletionContent(response);
    const parsedContent = parseEnrichmentContent(content);
    await writeJsonFile(outputPath, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      enabled: true,
      provider: url.origin,
      model,
      status: "completed",
      summary: parsedContent.summary,
      recommendations: parsedContent.recommendations,
    } satisfies AiEnrichmentReport);
  } catch (error) {
    await writeJsonFile(outputPath, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      enabled: true,
      model,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    } satisfies AiEnrichmentReport);
  }

  console.log(`AI enrichment report written to ${outputPath}`);
}

function extractCompletionContent(response: unknown): string {
  if (typeof response !== "object" || response === null) {
    return "";
  }

  const choices = (response as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) {
    return "";
  }

  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  return typeof message?.content === "string" ? message.content : "";
}

function parseEnrichmentContent(content: string): {
  summary: string;
  recommendations: string[];
} {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : content,
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
    };
  } catch {
    return { summary: content, recommendations: [] };
  }
}
