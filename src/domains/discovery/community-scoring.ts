import type { AssetCatalogEntry } from "../../types.js";

/**
 * Describes a community asset safety score and review decision.
 */
export interface CommunityAssetScore {
  assetId: string;
  score: number;
  decision: "promote" | "review" | "quarantine";
  reasons: string[];
}

const COMMUNITY_TIERS = new Set([
  "trusted-community",
  "community",
  "experimental",
]);

const RISKY_COMMUNITY_KINDS = new Set([
  "hook",
  "plugin",
  "mcp-server",
  "extension",
]);

/**
 * Scores a community asset with explainable safety and quality signals.
 */
export function scoreCommunityAsset(
  entry: AssetCatalogEntry,
): CommunityAssetScore {
  let score = 50;
  const reasons: string[] = [];

  if (!COMMUNITY_TIERS.has(entry.source.authorityTier)) {
    return {
      assetId: entry.id,
      score: 100,
      decision: "promote",
      reasons: ["non-community authority tier keeps source-trust policy"],
    };
  }

  if (entry.source.publisherVerified) {
    score += 10;
    reasons.push("publisher is marked verified");
  }

  if (entry.evidence.readmeFound) {
    score += 10;
    reasons.push("README evidence is present");
  }

  if (entry.evidence.manifestFound) {
    score += 10;
    reasons.push("asset manifest evidence is present");
  }

  if (entry.maintenance.stars > 100) {
    score += 5;
    reasons.push("stars provide weak popularity support");
  }

  if (entry.maintenance.releaseCadence === "stale") {
    score -= 20;
    reasons.push("release cadence is stale");
  }

  if (
    entry.risk.hasHooks ||
    entry.risk.hasExecScripts ||
    entry.risk.requiresNetwork
  ) {
    score -= 30;
    reasons.push(
      "asset declares hooks, executable scripts, or network behavior",
    );
  }

  if (RISKY_COMMUNITY_KINDS.has(entry.assetKind)) {
    score -= 20;
    reasons.push("community executable/integration asset requires review");
  }

  if (entry.dedupe.duplicateGroup) {
    score -= 10;
    reasons.push("asset duplicates an existing capability group");
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  const decision = decideCommunityAsset(entry, boundedScore);

  return {
    assetId: entry.id,
    score: boundedScore,
    decision,
    reasons,
  };
}

/**
 * Returns true when community policy requires quarantine/review before activation.
 */
export function shouldQuarantineCommunityAsset(
  entry: AssetCatalogEntry,
): boolean {
  return scoreCommunityAsset(entry).decision === "quarantine";
}

function decideCommunityAsset(
  entry: AssetCatalogEntry,
  score: number,
): CommunityAssetScore["decision"] {
  if (!COMMUNITY_TIERS.has(entry.source.authorityTier)) {
    return "promote";
  }

  if (
    RISKY_COMMUNITY_KINDS.has(entry.assetKind) ||
    entry.risk.level === "high" ||
    entry.risk.hasHooks ||
    entry.risk.hasExecScripts ||
    entry.risk.requiresNetwork ||
    score < 40
  ) {
    return "quarantine";
  }

  if (score < 70) {
    return "review";
  }

  return "promote";
}
